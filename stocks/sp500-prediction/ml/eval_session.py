#!/usr/bin/env python3
"""
eval_session.py — Evaluate existing models but only on open/power hour candles.
This shows what precision would be if you train on ALL data but only trade during
high-signal sessions.

Usage:
  python -m ml.eval_session --session open --models XGBoost --fsets G_spy_optimized
  python -m ml.eval_session --session power
  python -m ml.eval_session --session active  # open + power
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

from ml.data_loader import load_base_df, prepare_Xy
from ml.feature_engineer import add_features
from ml.config import FEATURE_SETS
from ml.target_variants import compute_target_variants, TARGET_META
from ml.evaluator import evaluate_classifier, log_result, print_result, print_top_results
from ml.session_filter import filter_session, SESSIONS

MODEL_MODULES = {
    "LightGBM": "ml.models.lightgbm_model",
    "XGBoost": "ml.models.xgboost_model",
    "CatBoost": "ml.models.catboost_model",
    "RandomForest": "ml.models.random_forest",
}


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


def run_session_eval(
    session: str,
    models_filter: list[str] | None = None,
    fsets_filter: list[str] | None = None,
    targets_filter: list[str] | None = None,
):
    print("=" * 70)
    print(f"  SESSION EVAL — Train on ALL, test on [{session.upper()}] only")
    print("=" * 70)

    # 1. Load ALL data
    t0 = time.time()
    df_base = load_base_df()
    print(f"  Loaded {len(df_base)} rows in {time.time() - t0:.1f}s")

    print("  Adding features...")
    t0 = time.time()
    df = add_features(df_base)
    print(f"  Feature engineering done ({df.shape[1]} cols) in {time.time() - t0:.1f}s")

    # 2. Temporal split FIRST (on all data), then filter test set by session
    # This way training has full data volume, but we only evaluate on target session
    targets_all = compute_target_variants(df)

    model_names = models_filter or ["XGBoost", "LightGBM"]
    fset_names = fsets_filter or ["G_spy_optimized", "E_clean"]
    target_names = targets_filter or list(TARGET_META.keys())

    session_prefix = f"EVAL_{session}_"
    total = len(model_names) * len(fset_names) * len(target_names)
    done = 0

    for model_name in model_names:
        mod = importlib.import_module(MODEL_MODULES[model_name])

        for fset_name in fset_names:
            feature_cols = FEATURE_SETS[fset_name]

            for target_name in target_names:
                done += 1
                is_mc, is_reg, desc = TARGET_META[target_name]
                logged_fset = session_prefix + fset_name
                tag = f"[{done}/{total}] {model_name} | {logged_fset} | {target_name}"
                print(f"\n--- {tag} ---")

                try:
                    bundle = targets_all[target_name]
                    y_full = np.asarray(bundle["y"])
                    valid_mask = np.asarray(bundle["valid"]).astype(bool)

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

                    X, y = prepare_Xy(df_target, feature_cols, target_col="_target")
                    if len(X) == 0:
                        print("  SKIP: empty X/y")
                        continue

                    # Temporal split — 80% train, 20% test (on ALL data)
                    n = len(X)
                    train_end = int(n * 0.8)
                    embargo = 30
                    test_start = min(train_end + embargo, n - 1)

                    X_train = X.iloc[:train_end]
                    y_train = y[:train_end]
                    X_test_all = X.iloc[test_start:]
                    y_test_all = y[test_start:]
                    df_test_all = df_target.iloc[test_start:]

                    # Now filter TEST set by session
                    df_test_filtered = filter_session(df_test_all, session)
                    if len(df_test_filtered) < 20:
                        print(f"  SKIP: test set too small after session filter ({len(df_test_filtered)})")
                        continue

                    # Get the indices that survived the session filter
                    # We need to find which rows of X_test_all correspond to df_test_filtered
                    test_filtered_idx = df_test_filtered.index
                    # Map back to positions in X_test_all
                    test_all_positions = list(range(len(X_test_all)))
                    test_all_orig_idx = df_test_all.index.values

                    keep_mask = np.isin(test_all_orig_idx, test_filtered_idx)
                    X_test = X_test_all.iloc[keep_mask]
                    y_test = y_test_all[keep_mask]

                    print(f"  Train: {len(X_train)} | Test (all): {len(X_test_all)} | Test [{session}]: {len(X_test)}")

                    if len(X_test) < 20:
                        print("  SKIP: filtered test too small")
                        continue

                    if len(np.unique(y_train)) < 2:
                        print("  SKIP: training split has only one class")
                        continue

                    # Scale
                    scaler = StandardScaler()
                    X_train_scaled = pd.DataFrame(
                        scaler.fit_transform(X_train), columns=X_train.columns, index=X_train.index
                    )
                    X_test_scaled = pd.DataFrame(
                        scaler.transform(X_test), columns=X_test.columns, index=X_test.index
                    )

                    # Val split for early stopping
                    val_n = int(len(X_train_scaled) * 0.15)
                    X_val = X_train_scaled.iloc[-val_n:]
                    y_val = y_train[-val_n:]
                    X_train_final = X_train_scaled.iloc[:-val_n]
                    y_train_final = y_train[:-val_n]

                    sample_w = compute_sample_weights(y_train_final) if not is_reg else None

                    model = mod.make_model(is_mc, is_regression=is_reg)
                    model = mod.train(model, X_train_final, y_train_final, X_val, y_val, sample_weight=sample_w)

                    y_pred = model.predict(X_test_scaled)
                    y_proba_all = model.predict_proba(X_test_scaled)
                    result = evaluate_classifier(y_test, y_pred, y_proba_all, model_name, logged_fset, target_name, is_mc)

                    log_result(result)
                    print_result(result)

                except Exception as e:
                    print(f"  ERROR: {e}")
                    traceback.print_exc()
                    continue

    print("\n" + "=" * 70)
    print(f"  SESSION EVAL [{session.upper()}] COMPLETE")
    print("=" * 70)
    print_top_results(10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True, choices=list(SESSIONS.keys()))
    parser.add_argument("--models", nargs="+", default=None)
    parser.add_argument("--fsets", nargs="+", default=None)
    parser.add_argument("--targets", nargs="+", default=None)
    args = parser.parse_args()

    run_session_eval(
        session=args.session,
        models_filter=args.models,
        fsets_filter=args.fsets,
        targets_filter=args.targets,
    )
