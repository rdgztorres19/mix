#!/usr/bin/env python3
"""
run_grid.py — Exhaustive experiment grid para S&P 500.
Itera: modelo x feature_set x target_variant
Para cada combo: train -> evaluate -> log results.

Usage:
  cd sp500-prediction
  python -m ml.run_grid
  python -m ml.run_grid --models LightGBM XGBoost
  python -m ml.run_grid --quick
  python -m ml.run_grid --session open       # solo 09:30-10:00
  python -m ml.run_grid --session power      # solo 14:30-16:00
  python -m ml.run_grid --session active     # open + power (sin midday)
"""

import argparse
import importlib
import sys
import time
import traceback
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.data_loader import load_base_df, temporal_split, prepare_Xy
from ml.feature_engineer import add_features
from ml.config import FEATURE_SETS
from ml.target_variants import compute_target_variants, TARGET_META
from ml.evaluator import evaluate_classifier, evaluate_regressor, log_result, print_result, print_top_results
from ml.session_filter import filter_session, SESSIONS


# ---------------------------------------------------------------------------
# Skip already-completed combos
# ---------------------------------------------------------------------------
def _load_completed() -> set:
    csv_path = Path(__file__).resolve().parent / "results" / "grid_results.csv"
    if not csv_path.exists():
        return set()
    try:
        df = pd.read_csv(csv_path)
        return set(zip(df["model"], df["feature_set"], df["target"]))
    except Exception:
        return set()


# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------
MODEL_MODULES = {
    "LightGBM": "ml.models.lightgbm_model",
    "XGBoost": "ml.models.xgboost_model",
    "CatBoost": "ml.models.catboost_model",
    "RandomForest": "ml.models.random_forest",
    "LSTM": "ml.models.lstm_model",
}


def _load_model_module(name: str):
    return importlib.import_module(MODEL_MODULES[name])


# ---------------------------------------------------------------------------
# Compute class weights as sample_weight array
# ---------------------------------------------------------------------------
def compute_sample_weights(y: np.ndarray) -> np.ndarray:
    classes = np.unique(y)
    n = len(y)
    n_classes = len(classes)
    counts = {c: (y == c).sum() for c in classes}
    weights = np.ones(n, dtype=np.float64)
    for c in classes:
        w = n / (n_classes * max(1, counts[c]))
        weights[y == c] = w
    return weights


# ---------------------------------------------------------------------------
# Main grid
# ---------------------------------------------------------------------------
def run_grid(
    models_filter: list[str] | None = None,
    fsets_filter: list[str] | None = None,
    targets_filter: list[str] | None = None,
    quick: bool = False,
    session: str = "all",
):
    session_label = f" [{session.upper()}]" if session != "all" else ""
    print("=" * 70)
    print(f"  SP500 EXPERIMENT GRID{session_label} — Loading data")
    print("=" * 70)

    # 1. Load base CSV
    t0 = time.time()
    df_base = load_base_df()
    print(f"  Loaded {len(df_base)} rows in {time.time() - t0:.1f}s")

    # 2. Feature engineering
    print(f"  Adding features...")
    t0 = time.time()
    df = add_features(df_base)
    print(f"  Feature engineering done ({df.shape[1]} cols) in {time.time() - t0:.1f}s")

    # 3. Session filter BEFORE target computation
    if session != "all":
        before = len(df)
        df = filter_session(df, session)
        print(f"  Session filter [{session}]: {before} → {len(df)} rows ({len(df)/before*100:.0f}%)")

    # 4. Compute all target variants
    targets = compute_target_variants(df)

    # 5. Determine grid
    model_names = models_filter or list(MODEL_MODULES.keys())
    fset_names = fsets_filter or list(FEATURE_SETS.keys())
    target_names = targets_filter or list(TARGET_META.keys())

    if quick:
        model_names = [m for m in model_names if m in ("LightGBM", "XGBoost")]
        fset_names = [f for f in fset_names if f in ("E_clean", "G_spy_optimized", "F_all")]
        target_names = [t for t in target_names if t in (
            "bin_rr10m_ge_2",
            "vs_tb10m_10_07", "vs_tb10m_15_10",
            "vs_tb30m_15_10", "vs_tb30m_20_10",
        )]

    # For session runs, prefix the feature_set name so results don't collide
    session_prefix = f"S_{session}_" if session != "all" else ""

    completed = _load_completed()
    total = len(model_names) * len(fset_names) * len(target_names)
    skipped_count = sum(
        1 for m in model_names for f in fset_names for t in target_names
        if (m, session_prefix + f, t) in completed
    )

    print(f"\n  Grid: {len(model_names)} models x {len(fset_names)} fsets x {len(target_names)} targets = {total} combos")
    print(f"  Already completed: {skipped_count}, remaining: {total - skipped_count}\n")

    done = 0
    for model_name in model_names:
        mod = _load_model_module(model_name)

        for fset_name in fset_names:
            feature_cols = FEATURE_SETS[fset_name]
            logged_fset = session_prefix + fset_name

            for target_name in target_names:
                done += 1
                is_mc, is_reg, desc = TARGET_META[target_name]
                tag = f"[{done}/{total}] {model_name} | {logged_fset} | {target_name}"

                if (model_name, logged_fset, target_name) in completed:
                    print(f"\n--- {tag} --- SKIP (already done)")
                    continue

                print(f"\n--- {tag} ---")

                try:
                    bundle = targets[target_name]
                    y_full = np.asarray(bundle["y"])
                    valid_mask = np.asarray(bundle["valid"]).astype(bool)

                    # Filter valid rows
                    df_target = df.loc[valid_mask].copy()
                    if len(df_target) == 0:
                        print("  SKIP: no valid rows")
                        continue

                    df_target["_target"] = y_full[valid_mask]

                    if not is_reg:
                        unique_labels = np.unique(df_target["_target"])
                        if len(unique_labels) < 2:
                            print(f"  SKIP: only {len(unique_labels)} class(es)")
                            continue

                    # Prepare X, y
                    X, y = prepare_Xy(df_target, feature_cols, target_col="_target")
                    if len(X) == 0:
                        print("  SKIP: empty X/y")
                        continue

                    # Remap multiclass labels if needed
                    label_map = None
                    if is_mc and not is_reg and y.min() < 0:
                        unique_sorted = np.array(sorted(np.unique(y)))
                        label_map = {old: new for new, old in enumerate(unique_sorted)}
                        y = np.array([label_map[v] for v in y])

                    # LSTM special handling
                    if model_name == "LSTM":
                        from ml.models.lstm_model import prepare_sequences, SEQUENCE_LENGTH
                        X_arr = X.values if hasattr(X, "values") else X
                        X_seq, y_seq = prepare_sequences(X_arr, y, SEQUENCE_LENGTH)
                        if len(X_seq) == 0:
                            print("  SKIP: not enough data for LSTM sequences")
                            continue

                        split_idx = int(len(X_seq) * 0.8)
                        X_train = X_seq[:split_idx]
                        X_test = X_seq[split_idx:]
                        y_train = y_seq[:split_idx]
                        y_test = y_seq[split_idx:]

                        model = mod.make_model(
                            is_mc, is_regression=is_reg,
                            n_features=X_arr.shape[1],
                            sequence_length=SEQUENCE_LENGTH,
                        )
                        model = mod.train(model, X_train, y_train, X_test, y_test)

                        if is_reg:
                            y_pred = model.predict(X_test).flatten()
                            result = evaluate_regressor(y_test, y_pred, model_name, logged_fset, target_name)
                        else:
                            y_proba = model.predict(X_test)
                            if y_proba.ndim == 1 or y_proba.shape[1] == 1:
                                p = y_proba.flatten()
                                y_proba_all = np.column_stack([1 - p, p])
                            else:
                                y_proba_all = y_proba
                            y_pred = (y_proba_all[:, 1] >= 0.5).astype(int) if not is_mc else y_proba_all.argmax(axis=1)
                            result = evaluate_classifier(y_test, y_pred, y_proba_all, model_name, logged_fset, target_name, is_mc)

                    else:
                        # Tree-based models
                        X_train, X_test, y_train, y_test = temporal_split(X, y, train_frac=0.8, embargo_rows=30)

                        if len(X_test) < 20:
                            print(f"  SKIP: test set too small ({len(X_test)})")
                            continue

                        if not is_reg and len(np.unique(y_train)) < 2:
                            print("  SKIP: training split has only one class")
                            continue

                        # Scale features
                        scaler = StandardScaler()
                        X_train_scaled = pd.DataFrame(
                            scaler.fit_transform(X_train), columns=X_train.columns, index=X_train.index
                        )
                        X_test_scaled = pd.DataFrame(
                            scaler.transform(X_test), columns=X_test.columns, index=X_test.index
                        )

                        # Validation split for early stopping
                        val_frac = 0.15
                        val_n = int(len(X_train_scaled) * val_frac)
                        X_val = X_train_scaled.iloc[-val_n:]
                        y_val = y_train[-val_n:]
                        X_train_final = X_train_scaled.iloc[:-val_n]
                        y_train_final = y_train[:-val_n]

                        sample_w = compute_sample_weights(y_train_final) if not is_reg else None

                        model = mod.make_model(is_mc, is_regression=is_reg)
                        model = mod.train(model, X_train_final, y_train_final, X_val, y_val, sample_weight=sample_w)

                        if is_reg:
                            y_pred = model.predict(X_test_scaled)
                            result = evaluate_regressor(y_test, y_pred, model_name, logged_fset, target_name)
                        else:
                            y_pred = model.predict(X_test_scaled)
                            y_proba_all = model.predict_proba(X_test_scaled)
                            result = evaluate_classifier(y_test, y_pred, y_proba_all, model_name, logged_fset, target_name, is_mc)

                    # Log & print
                    log_result(result)
                    print_result(result)

                except Exception as e:
                    print(f"  ERROR: {e}")
                    traceback.print_exc()
                    continue

    print("\n" + "=" * 70)
    print("  GRID COMPLETE")
    print("=" * 70)
    print_top_results(10)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", nargs="+", default=None)
    parser.add_argument("--fsets", nargs="+", default=None)
    parser.add_argument("--targets", nargs="+", default=None)
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--session", default="all", choices=list(SESSIONS.keys()),
                        help="Filter data by session: open, morning, midday, power, active, all")
    args = parser.parse_args()

    run_grid(
        models_filter=args.models,
        fsets_filter=args.fsets,
        targets_filter=args.targets,
        quick=args.quick,
        session=args.session,
    )
