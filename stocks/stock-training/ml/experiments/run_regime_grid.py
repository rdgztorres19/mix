#!/usr/bin/env python3
"""
run_regime_grid.py — Grid search with HMM regime detection.

Fits HMM on training data to detect market regimes (calm/normal/volatile).
Then trains models two ways:
  A) One model per regime (only sees data from that regime)
  B) One combined model with hmm_regime as feature

Compares regime-specific performance vs single model.

Usage:
  cd stock-training/ml
  python -m experiments.run_regime_grid
  python -m experiments.run_regime_grid --csv data/training-v2-morning-full-with-news.csv --max-rows 2000000
  python -m experiments.run_regime_grid --n-regimes 3 --fsets V2_full D_clean
"""

import argparse
import csv
import gc
import importlib
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.data_loader import load_df_with_features, temporal_split, prepare_Xy
from experiments.feature_engineer import add_features, FEATURE_SETS
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.evaluator import evaluate_model, precision_at_threshold, log_result
from experiments.regime_detection import fit_regime_hmm, predict_regimes, label_regimes, add_regime_features
from experiments.run_grid import compute_sample_weights, MODEL_MODULES

# ── Config ────────────────────────────────────────────────────────────────

RESULTS_DIR = Path(__file__).resolve().parent / "results"
REGIME_CSV = RESULTS_DIR / "regime_grid_results.csv"

# Regime features: volatility + volume signals
REGIME_FEATURES = ["volatility_15m", "volume_rel", "atr_rel"]

DEFAULT_TARGETS = [
    "bin_rr10m_ge_2",
    "bin_tb30m_tp3p0_sl1p5",
    "bin_tb30m_tp4p0_sl2p0",
]

DEFAULT_FSETS = ["V2_full", "D_clean", "V4_orderflow"]
DEFAULT_MODELS = ["XGBoost", "LightGBM"]


def _load_model_module(name: str):
    return importlib.import_module(MODEL_MODULES[name])


def _write_result(row: dict):
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    file_exists = REGIME_CSV.exists()
    with open(REGIME_CSV, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=row.keys())
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)


def train_and_evaluate(
    model_name: str,
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    is_mc: bool = False,
    n_jobs: int = 4,
):
    """Train a model and return evaluation metrics."""
    sw = compute_sample_weights(y_train)

    extra_params = {}
    if is_mc and model_name in ("XGBoost", "LightGBM"):
        extra_params["num_class"] = len(np.unique(y_train))

    mod = _load_model_module(model_name)
    model = mod.make_model(is_multiclass=is_mc, n_jobs=n_jobs, **extra_params)

    val_split = int(len(X_train) * 0.9)
    if val_split <= 0 or val_split >= len(X_train):
        return None

    X_tr, y_tr = X_train[:val_split], y_train[:val_split]
    X_vl, y_vl = X_train[val_split:], y_train[val_split:]
    sw_tr = sw[:val_split]

    try:
        mod.train(model, X_tr, y_tr, X_val=X_vl, y_val=y_vl, sample_weight=sw_tr)
    except TypeError:
        try:
            mod.train(model, X_tr, y_tr, X_val=X_vl, y_val=y_vl)
        except TypeError:
            model.fit(X_tr, y_tr, sample_weight=sw_tr)

    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)

    return y_pred, y_proba


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=None)
    parser.add_argument("--max-rows", type=int, default=2000000)
    parser.add_argument("--n-regimes", type=int, default=3)
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    parser.add_argument("--fsets", nargs="+", default=DEFAULT_FSETS)
    parser.add_argument("--targets", nargs="+", default=DEFAULT_TARGETS)
    args = parser.parse_args()

    import os
    n_cores = os.cpu_count() or 8
    n_jobs = max(1, n_cores // 4)

    # ── Load Data ─────────────────────────────────────────────────────
    print("=" * 70)
    print("  REGIME GRID — Loading data")
    print("=" * 70)

    t0 = time.time()
    if args.csv:
        csv_p = Path(args.csv)
        if not csv_p.is_absolute():
            csv_p = Path(__file__).resolve().parent.parent.parent / args.csv
        df = pd.read_csv(csv_p, low_memory=False)
        if args.max_rows and len(df) > args.max_rows:
            df = df.tail(args.max_rows).reset_index(drop=True)
        print(f"  Loaded {len(df)} rows")
        df = add_features(df)
        print(f"  Features done ({df.shape[1]} cols)")
        if "valid_for_training" in df.columns:
            n_before = len(df)
            df = df[df["valid_for_training"] == 1].reset_index(drop=True)
            print(f"  Filtered valid: {n_before} → {len(df)}")
    else:
        df = load_df_with_features(filter_valid=True)

    print(f"  Data ready: {len(df)} rows in {time.time() - t0:.1f}s")

    # ── Compute Targets ───────────────────────────────────────────────
    print("  Computing targets...")
    targets = compute_target_variants(df)
    gc.collect()

    # ── Temporal Split (before HMM fit) ───────────────────────────────
    n = len(df)
    train_end = int(n * 0.8)
    embargo = 30
    test_start = min(train_end + embargo, n - 1)

    df_train = df.iloc[:train_end].copy()
    df_test = df.iloc[test_start:].copy()
    print(f"  Train: {len(df_train)} rows, Test: {len(df_test)} rows")

    # ── Fit HMM on TRAIN only (no leakage) ────────────────────────────
    print(f"\n  Fitting HMM ({args.n_regimes} regimes) on TRAIN data...")

    available_regime_feats = [f for f in REGIME_FEATURES if f in df_train.columns]
    if len(available_regime_feats) < 2:
        print(f"  ERROR: need >= 2 regime features, have {available_regime_feats}")
        sys.exit(1)

    X_regime_train = df_train[available_regime_feats].fillna(0).values
    hmm = fit_regime_hmm(X_regime_train, n_regimes=args.n_regimes)

    # Predict regimes for both train and test
    train_regimes = predict_regimes(hmm, X_regime_train)
    X_regime_test = df_test[available_regime_feats].fillna(0).values
    test_regimes = predict_regimes(hmm, X_regime_test)

    df_train["hmm_regime"] = train_regimes
    df_test["hmm_regime"] = test_regimes
    df_train = add_regime_features(df_train, "hmm_regime")
    df_test = add_regime_features(df_test, "hmm_regime")

    # Label and print regime distribution
    labels = label_regimes(train_regimes, X_regime_train, available_regime_feats)
    print(f"\n  Regimes detected: {labels}")
    for rid, name in labels.items():
        train_pct = (train_regimes == rid).mean() * 100
        test_pct = (test_regimes == rid).mean() * 100
        print(f"    Regime {rid} ({name}): train={train_pct:.1f}%, test={test_pct:.1f}%")

    # ── Grid Search ───────────────────────────────────────────────────
    total_combos = len(args.models) * len(args.fsets) * len(args.targets)
    print(f"\n  Grid: {len(args.models)} models × {len(args.fsets)} fsets × {len(args.targets)} targets = {total_combos} combos")
    print(f"  For each combo: 1 combined model + {args.n_regimes} regime-specific models")
    print()

    combo_idx = 0
    for model_name in args.models:
        for fset_name in args.fsets:
            if fset_name not in FEATURE_SETS:
                print(f"  SKIP: unknown fset {fset_name}")
                continue

            for target_name in args.targets:
                combo_idx += 1
                is_mc = TARGET_META.get(target_name, (False, ""))[0]
                tag = f"[{combo_idx}/{total_combos}] {model_name} | {fset_name} | {target_name}"

                try:
                    if target_name not in targets:
                        continue

                    bundle = targets[target_name]
                    y_full = np.asarray(bundle["y"])
                    valid = np.asarray(bundle["valid"]).astype(bool)

                    # Apply target to train/test
                    y_train_full = y_full[:train_end]
                    valid_train = valid[:train_end]
                    y_test_full = y_full[test_start:]
                    valid_test = valid[test_start:]

                    # Feature columns (add hmm features for combined model)
                    feature_cols = FEATURE_SETS[fset_name]
                    feature_cols_with_regime = list(feature_cols) + ["hmm_regime", "regime_duration", "regime_transition"]

                    # ── A) Combined model (hmm_regime as feature) ─────────
                    X_train_comb, y_train_comb = prepare_Xy(
                        df_train.loc[valid_train].assign(_target=y_train_full[valid_train]),
                        feature_cols_with_regime, target_col="_target"
                    )
                    X_test_comb, y_test_comb = prepare_Xy(
                        df_test.loc[valid_test].assign(_target=y_test_full[valid_test]),
                        feature_cols_with_regime, target_col="_target"
                    )

                    if len(X_train_comb) < 100 or len(X_test_comb) < 50:
                        continue
                    if len(np.unique(y_train_comb)) < 2 or len(np.unique(y_test_comb)) < 2:
                        continue

                    scaler_comb = StandardScaler()
                    X_tr_s = scaler_comb.fit_transform(X_train_comb)
                    X_te_s = scaler_comb.transform(X_test_comb)

                    t0 = time.time()
                    result = train_and_evaluate(model_name, X_tr_s, y_train_comb, X_te_s, y_test_comb, is_mc, n_jobs)
                    if result is None:
                        continue
                    y_pred, y_proba = result
                    elapsed = time.time() - t0

                    probs = y_proba[:, 1] if y_proba.shape[1] > 1 else y_proba[:, 0]
                    p60, n60 = precision_at_threshold(y_test_comb, probs, 0.60)
                    p70, n70 = precision_at_threshold(y_test_comb, probs, 0.70)
                    p80, n80 = precision_at_threshold(y_test_comb, probs, 0.80)

                    row = {
                        "model": model_name, "feature_set": fset_name, "target": target_name,
                        "mode": "combined_with_regime",
                        "regime": "all",
                        "n_train": len(X_train_comb), "n_test": len(X_test_comb),
                        "prec_at_0.6": round(p60, 4), "signals_at_0.6": n60,
                        "prec_at_0.7": round(p70, 4), "signals_at_0.7": n70,
                        "prec_at_0.8": round(p80, 4), "signals_at_0.8": n80,
                        "time_sec": round(elapsed, 1),
                    }
                    _write_result(row)
                    print(f"  ✓ {tag} COMBINED: P@0.7={p70:.4f}({n70}) P@0.8={p80:.4f}({n80}) {elapsed:.1f}s")

                    # ── B) Per-regime models ───────────────────────────────
                    for rid in sorted(np.unique(train_regimes)):
                        regime_name = labels.get(rid, f"regime_{rid}")

                        train_mask = (train_regimes == rid) & valid_train
                        test_mask = (test_regimes == rid) & valid_test

                        df_tr_r = df_train.loc[train_mask].copy()
                        df_te_r = df_test.loc[test_mask].copy()

                        if len(df_tr_r) < 100 or len(df_te_r) < 30:
                            print(f"    Regime {rid} ({regime_name}): skip (train={len(df_tr_r)}, test={len(df_te_r)})")
                            continue

                        df_tr_r["_target"] = y_train_full[train_mask]
                        df_te_r["_target"] = y_test_full[test_mask]

                        X_tr_r, y_tr_r = prepare_Xy(df_tr_r, feature_cols, target_col="_target")
                        X_te_r, y_te_r = prepare_Xy(df_te_r, feature_cols, target_col="_target")

                        if len(np.unique(y_tr_r)) < 2 or len(np.unique(y_te_r)) < 2:
                            continue

                        scaler_r = StandardScaler()
                        X_tr_rs = scaler_r.fit_transform(X_tr_r)
                        X_te_rs = scaler_r.transform(X_te_r)

                        t0 = time.time()
                        result_r = train_and_evaluate(model_name, X_tr_rs, y_tr_r, X_te_rs, y_te_r, is_mc, n_jobs)
                        if result_r is None:
                            continue
                        y_pred_r, y_proba_r = result_r
                        elapsed_r = time.time() - t0

                        probs_r = y_proba_r[:, 1] if y_proba_r.shape[1] > 1 else y_proba_r[:, 0]
                        p60_r, n60_r = precision_at_threshold(y_te_r, probs_r, 0.60)
                        p70_r, n70_r = precision_at_threshold(y_te_r, probs_r, 0.70)
                        p80_r, n80_r = precision_at_threshold(y_te_r, probs_r, 0.80)

                        row_r = {
                            "model": model_name, "feature_set": fset_name, "target": target_name,
                            "mode": "per_regime",
                            "regime": f"{rid}_{regime_name}",
                            "n_train": len(X_tr_r), "n_test": len(X_te_r),
                            "prec_at_0.6": round(p60_r, 4), "signals_at_0.6": n60_r,
                            "prec_at_0.7": round(p70_r, 4), "signals_at_0.7": n70_r,
                            "prec_at_0.8": round(p80_r, 4), "signals_at_0.8": n80_r,
                            "time_sec": round(elapsed_r, 1),
                        }
                        _write_result(row_r)

                        marker = "★" if p70_r > p70 else " "
                        print(f"    Regime {rid} ({regime_name}): P@0.7={p70_r:.4f}({n70_r}) "
                              f"P@0.8={p80_r:.4f}({n80_r}) train={len(X_tr_r)} test={len(X_te_r)} {marker}")

                except Exception as e:
                    print(f"  ✗ {tag} ERROR: {e}")
                    traceback.print_exc()

    # ── Summary ───────────────────────────────────────────────────────
    if REGIME_CSV.exists():
        results = pd.read_csv(REGIME_CSV)
        print(f"\n{'='*70}")
        print(f"  REGIME GRID COMPLETE — {len(results)} results")
        print(f"{'='*70}")

        # Best per-regime results vs combined
        combined = results[results["mode"] == "combined_with_regime"].sort_values("prec_at_0.7", ascending=False)
        per_regime = results[results["mode"] == "per_regime"].sort_values("prec_at_0.7", ascending=False)

        print(f"\n  TOP 5 Combined (with hmm_regime feature):")
        for _, r in combined.head(5).iterrows():
            print(f"    {r['model']:<12} {r['feature_set']:<20} {r['target']:<25} P@0.7={r['prec_at_0.7']:.4f}({int(r['signals_at_0.7'])})")

        print(f"\n  TOP 10 Per-Regime:")
        for _, r in per_regime.head(10).iterrows():
            print(f"    {r['model']:<12} {r['feature_set']:<20} {r['target']:<25} {r['regime']:<15} P@0.7={r['prec_at_0.7']:.4f}({int(r['signals_at_0.7'])})")


if __name__ == "__main__":
    main()
