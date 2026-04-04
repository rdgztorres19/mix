#!/usr/bin/env python3
"""
run_cpcv_validation.py — Validate top grid combos with CPCV + Deflated Sharpe Ratio.

Takes the best combos from grid_results.csv and re-evaluates them with:
  1. Combinatorial Purged Cross-Validation (45 paths, n_splits=10, n_test_groups=2)
  2. Feature clustering (reduce correlated features)
  3. Deflated Sharpe Ratio (correct for multiple testing)
  4. Probability calibration (Platt scaling)

This tells us which results are statistically genuine vs false discoveries.

Usage:
  cd stock-training/ml
  python -m experiments.run_cpcv_validation
  python -m experiments.run_cpcv_validation --csv data/training-v2-morning-full-with-news.csv --max-rows 2000000
  python -m experiments.run_cpcv_validation --quick   # 10 paths instead of 45
"""

import argparse
import csv
import gc
import importlib
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.calibration import CalibratedClassifierCV

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.data_loader import (
    load_df_with_features, prepare_Xy, cpcv_split, cluster_features,
)
from experiments.feature_engineer import add_features, FEATURE_SETS
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.evaluator import (
    precision_at_threshold, deflated_sharpe_ratio, calibration_metrics,
)
from experiments.run_grid import compute_sample_weights, MODEL_MODULES

RESULTS_DIR = Path(__file__).resolve().parent / "results"
CPCV_CSV = RESULTS_DIR / "cpcv_validation_results.csv"

# Top combos to validate (from all previous grid searches)
TOP_COMBOS = [
    # Best direction models
    ("LightGBM", "V4_orderflow", "bin_rr10m_ge_2"),
    ("LightGBM", "V2_full", "bin_rr10m_ge_2"),
    ("XGBoost", "V2_full", "bin_rr10m_ge_2"),
    ("XGBoost", "V2_core", "bin_rr10m_ge_2"),
    ("XGBoost", "D_clean", "bin_rr10m_ge_2"),
    # Best triple barrier
    ("LightGBM", "V2_full", "bin_tb30m_tp3p0_sl1p5"),
    ("XGBoost", "V2_full", "bin_tb30m_tp3p0_sl1p5"),
    # Vol expansion (known to work)
    ("XGBoost", "V2_full", "bin_vol_exp_10m_2atr"),
]

# Total trials across ALL experiments ever run (for DSR)
TOTAL_TRIALS_ESTIMATED = 500


def _load_model_module(name: str):
    return importlib.import_module(MODEL_MODULES[name])


def _write_result(row: dict):
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    file_exists = CPCV_CSV.exists()
    with open(CPCV_CSV, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=row.keys())
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)


def validate_combo(
    model_name: str,
    fset_name: str,
    target_name: str,
    df: pd.DataFrame,
    targets: dict,
    n_splits: int = 10,
    n_test_groups: int = 2,
    do_cluster: bool = True,
    do_calibrate: bool = True,
    n_jobs: int = 4,
) -> dict | None:
    """Run CPCV validation on one combo. Returns result dict."""

    is_mc = TARGET_META.get(target_name, (False, ""))[0]
    print(f"\n{'═'*70}")
    print(f"  {model_name} | {fset_name} | {target_name}")
    print(f"{'═'*70}")

    if target_name not in targets:
        print(f"  Target not found")
        return None

    bundle = targets[target_name]
    y_full = np.asarray(bundle["y"])
    valid = np.asarray(bundle["valid"]).astype(bool)

    df_target = df.loc[valid].copy()
    df_target["_target"] = y_full[valid]

    if "valid_for_training" in df_target.columns:
        df_target = df_target[df_target["valid_for_training"] == 1].reset_index(drop=True)

    if len(df_target) < 1000 or df_target["_target"].nunique() < 2:
        print(f"  Skip: insufficient data ({len(df_target)} rows)")
        return None

    feature_cols = FEATURE_SETS[fset_name]
    X, y = prepare_Xy(df_target, feature_cols, target_col="_target")

    if len(X) < 500:
        print(f"  Skip: only {len(X)} rows after prepare_Xy")
        return None

    # Optional: cluster features
    original_n_features = len(feature_cols)
    if do_cluster:
        clustered_cols = cluster_features(X, corr_threshold=0.85)
        X = X[clustered_cols]
        print(f"  Features: {original_n_features} → {len(clustered_cols)} (after clustering)")
    else:
        clustered_cols = list(X.columns)

    # CPCV splits
    from itertools import combinations
    total_paths = len(list(combinations(range(n_splits), n_test_groups)))
    print(f"  CPCV: {n_splits} splits, {n_test_groups} test groups → {total_paths} paths")

    t0 = time.time()
    folds = cpcv_split(X, y, n_splits=n_splits, n_test_groups=n_test_groups, embargo_pct=0.01)
    print(f"  Generated {len(folds)} valid folds")

    # Train and evaluate on each fold
    fold_metrics = []
    fold_pnls = []  # for Sharpe computation

    for fold_idx, (train_idx, test_idx) in enumerate(folds):
        X_train = X.iloc[train_idx]
        X_test = X.iloc[test_idx]
        y_train = y[train_idx]
        y_test = y[test_idx]

        if len(np.unique(y_train)) < 2 or len(np.unique(y_test)) < 2:
            continue

        scaler = StandardScaler()
        X_train_s = scaler.fit_transform(X_train)
        X_test_s = scaler.transform(X_test)

        sw = compute_sample_weights(y_train)

        extra_params = {}
        if is_mc and model_name in ("XGBoost", "LightGBM"):
            extra_params["num_class"] = len(np.unique(y_train))

        mod = _load_model_module(model_name)
        model = mod.make_model(is_multiclass=is_mc, n_jobs=n_jobs, **extra_params)

        val_split = int(len(X_train_s) * 0.85)
        cal_split = int(len(X_train_s) * 0.925)

        if val_split <= 0 or cal_split >= len(X_train_s):
            continue

        X_tr = X_train_s[:val_split]
        y_tr = y_train[:val_split]
        X_vl = X_train_s[val_split:cal_split]
        y_vl = y_train[val_split:cal_split]
        X_cal = X_train_s[cal_split:]
        y_cal = y_train[cal_split:]
        sw_tr = sw[:val_split]

        try:
            mod.train(model, X_tr, y_tr, X_val=X_vl, y_val=y_vl, sample_weight=sw_tr)
        except TypeError:
            try:
                mod.train(model, X_tr, y_tr, X_val=X_vl, y_val=y_vl)
            except TypeError:
                model.fit(X_tr, y_tr, sample_weight=sw_tr)

        # Calibrate
        if do_calibrate and len(X_cal) >= 50:
            try:
                calibrated = CalibratedClassifierCV(model, method="sigmoid", cv="prefit")
                calibrated.fit(X_cal, y_cal)
                y_proba = calibrated.predict_proba(X_test_s)
            except Exception:
                y_proba = model.predict_proba(X_test_s)
        else:
            y_proba = model.predict_proba(X_test_s)

        probs = y_proba[:, 1] if y_proba.shape[1] > 1 else y_proba[:, 0]

        p60, n60 = precision_at_threshold(y_test, probs, 0.60)
        p70, n70 = precision_at_threshold(y_test, probs, 0.70)
        p80, n80 = precision_at_threshold(y_test, probs, 0.80)

        # ECE
        cal_met = calibration_metrics(y_test, probs)

        # Proxy PnL for Sharpe: +1 for correct high-confidence, -1 for wrong
        signals_mask = probs >= 0.60
        if signals_mask.sum() > 0:
            correct = (signals_mask & (y_test == 1)).sum()
            wrong = (signals_mask & (y_test == 0)).sum()
            pnl_proxy = (correct * 2 - wrong * 1) / max(signals_mask.sum(), 1)
        else:
            pnl_proxy = 0

        fold_metrics.append({
            "p60": p60, "n60": n60,
            "p70": p70, "n70": n70,
            "p80": p80, "n80": n80,
            "ece": cal_met["ece"],
            "n_test": len(y_test),
        })
        fold_pnls.append(pnl_proxy)

        if (fold_idx + 1) % 10 == 0:
            print(f"    Fold {fold_idx + 1}/{len(folds)} done...")

    elapsed = time.time() - t0

    if len(fold_metrics) < 3:
        print(f"  Skip: only {len(fold_metrics)} valid folds")
        return None

    # Aggregate metrics: mean ± std across folds
    p70_values = [m["p70"] for m in fold_metrics]
    p80_values = [m["p80"] for m in fold_metrics]
    p60_values = [m["p60"] for m in fold_metrics]
    ece_values = [m["ece"] for m in fold_metrics]

    mean_p60 = np.mean(p60_values)
    std_p60 = np.std(p60_values)
    mean_p70 = np.mean(p70_values)
    std_p70 = np.std(p70_values)
    mean_p80 = np.mean(p80_values)
    std_p80 = np.std(p80_values)
    mean_ece = np.mean(ece_values)

    # Deflated Sharpe Ratio
    pnl_array = np.array(fold_pnls)
    if pnl_array.std() > 0:
        sharpe = pnl_array.mean() / pnl_array.std() * np.sqrt(252)  # annualized
    else:
        sharpe = 0

    dsr_pval = deflated_sharpe_ratio(
        sharpe_observed=sharpe,
        n_trials=TOTAL_TRIALS_ESTIMATED,
        n_samples=len(fold_pnls),
    )

    # Result
    result = {
        "model": model_name,
        "feature_set": fset_name,
        "target": target_name,
        "n_folds": len(fold_metrics),
        "n_features_original": original_n_features,
        "n_features_clustered": len(clustered_cols),
        "calibrated": do_calibrate,
        "mean_p60": round(mean_p60, 4),
        "std_p60": round(std_p60, 4),
        "mean_p70": round(mean_p70, 4),
        "std_p70": round(std_p70, 4),
        "mean_p80": round(mean_p80, 4),
        "std_p80": round(std_p80, 4),
        "mean_ece": round(mean_ece, 4),
        "sharpe_annualized": round(sharpe, 4),
        "dsr_pvalue": dsr_pval,
        "dsr_significant": dsr_pval < 0.05,
        "time_sec": round(elapsed, 1),
    }

    _write_result(result)

    sig = "✓ SIGNIFICANT" if dsr_pval < 0.05 else "✗ NOT significant"
    print(f"\n  Results ({len(fold_metrics)} folds, {elapsed:.0f}s):")
    print(f"    P@0.60: {mean_p60:.4f} ± {std_p60:.4f}")
    print(f"    P@0.70: {mean_p70:.4f} ± {std_p70:.4f}")
    print(f"    P@0.80: {mean_p80:.4f} ± {std_p80:.4f}")
    print(f"    ECE:    {mean_ece:.4f} (calibration error)")
    print(f"    Sharpe: {sharpe:.4f} (annualized)")
    print(f"    DSR p-value: {dsr_pval:.4f} → {sig}")

    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=None)
    parser.add_argument("--max-rows", type=int, default=2000000)
    parser.add_argument("--quick", action="store_true", help="Use 5 splits (10 paths) instead of 10 (45)")
    parser.add_argument("--no-cluster", action="store_true", help="Skip feature clustering")
    parser.add_argument("--no-calibrate", action="store_true", help="Skip probability calibration")
    args = parser.parse_args()

    n_splits = 5 if args.quick else 10

    # Load data
    print("=" * 70)
    print("  CPCV VALIDATION — Loading data")
    print("=" * 70)

    t0 = time.time()
    if args.csv:
        csv_p = Path(args.csv)
        if not csv_p.is_absolute():
            csv_p = Path(__file__).resolve().parent.parent.parent / args.csv
        df = pd.read_csv(csv_p, low_memory=False)
        if args.max_rows and len(df) > args.max_rows:
            df = df.tail(args.max_rows).reset_index(drop=True)
        df = add_features(df)
        if "valid_for_training" in df.columns:
            n_before = len(df)
            df = df[df["valid_for_training"] == 1].reset_index(drop=True)
            print(f"  Filtered valid: {n_before} → {len(df)}")
    else:
        df = load_df_with_features(filter_valid=True)

    targets = compute_target_variants(df)
    gc.collect()
    print(f"  Data ready: {len(df)} rows in {time.time() - t0:.1f}s")

    print(f"\n  Validating {len(TOP_COMBOS)} combos with CPCV ({n_splits} splits)")
    print(f"  Feature clustering: {'ON' if not args.no_cluster else 'OFF'}")
    print(f"  Calibration: {'ON' if not args.no_calibrate else 'OFF'}")
    print(f"  Total historical trials for DSR: {TOTAL_TRIALS_ESTIMATED}")

    results = []
    for model_name, fset_name, target_name in TOP_COMBOS:
        r = validate_combo(
            model_name, fset_name, target_name,
            df, targets,
            n_splits=n_splits,
            n_test_groups=2,
            do_cluster=not args.no_cluster,
            do_calibrate=not args.no_calibrate,
        )
        if r:
            results.append(r)
        gc.collect()

    # Final summary
    print(f"\n\n{'='*70}")
    print(f"  CPCV VALIDATION COMPLETE — {len(results)} combos validated")
    print(f"{'='*70}")

    if results:
        results.sort(key=lambda r: r["mean_p70"], reverse=True)
        print(f"\n  {'Model':<12} {'Features':<20} {'Target':<25} {'P@0.7':>12} {'P@0.8':>12} {'ECE':>6} {'DSR p':>7} {'Sig?'}")
        print(f"  {'─'*12} {'─'*20} {'─'*25} {'─'*12} {'─'*12} {'─'*6} {'─'*7} {'─'*4}")
        for r in results:
            sig = "YES" if r["dsr_significant"] else "no"
            print(f"  {r['model']:<12} {r['feature_set']:<20} {r['target']:<25} "
                  f"{r['mean_p70']:.4f}±{r['std_p70']:.4f} "
                  f"{r['mean_p80']:.4f}±{r['std_p80']:.4f} "
                  f"{r['mean_ece']:.4f} {r['dsr_pvalue']:.4f} {sig}")

    print(f"\n  Results saved to: {CPCV_CSV}")


if __name__ == "__main__":
    main()
