#!/usr/bin/env python3
"""
run_fast_grid.py — Fast grid search with subsampling for exploration.
Uses stratified subsampling to speed up slow models (RF, ET, CatBoost).
Skips already-completed combos.

Usage:
  cd stock-training/ml
  python3 -m experiments.run_fast_grid
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

from experiments.data_loader import load_base_df, temporal_split, prepare_Xy
from experiments.feature_engineer import add_features, FEATURE_SETS
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.evaluator import evaluate_model, log_result, print_result, print_top_results

MODEL_MODULES = {
    "XGBoost": "experiments.models.xgb_native",
    "LightGBM": "experiments.models.lgbm_model",
    "CatBoost": "experiments.models.catboost_model",
    "RandomForest": "experiments.models.rf_optimized",
    "ExtraTrees": "experiments.models.extra_trees",
    "LogisticRegression": "experiments.models.logistic",
}

# Models that need subsampling to be fast
SLOW_MODELS = {"RandomForest", "ExtraTrees", "CatBoost"}
SUBSAMPLE_ROWS = 300_000  # Max rows for slow models


def _load_model_module(name: str):
    return importlib.import_module(MODEL_MODULES[name])


def _load_completed() -> set:
    csv_path = Path(__file__).resolve().parent / "results" / "grid_results.csv"
    if not csv_path.exists():
        return set()
    try:
        df = pd.read_csv(csv_path)
        return set(zip(df["model"], df["feature_set"], df["target"]))
    except Exception:
        return set()


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


def _subsample_temporal(df: pd.DataFrame, max_rows: int):
    """Subsample keeping temporal order — take every Nth row.
    Returns (subsampled_df, positional_indices) for array alignment."""
    if len(df) <= max_rows:
        return df, np.arange(len(df))
    step = len(df) // max_rows
    pos_indices = np.arange(0, len(df), step)[:max_rows]
    return df.iloc[pos_indices].copy(), pos_indices


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", nargs="+", default=["RandomForest", "ExtraTrees", "LogisticRegression", "CatBoost"])
    parser.add_argument("--fsets", nargs="+", default=["D_all", "B_enriched", "F_price_vol_time"])
    parser.add_argument("--targets", nargs="+", default=["mc_1p5", "mc_2p0", "bin_mfr10m_1p5", "bin_mfr10m_2p0", "mc_2p5"])
    parser.add_argument("--max-rows", type=int, default=SUBSAMPLE_ROWS)
    args = parser.parse_args()

    completed = _load_completed()

    print("=" * 70)
    print("  FAST GRID — Loading data")
    print("=" * 70)

    t0 = time.time()
    df_base = load_base_df()
    print(f"  Loaded {len(df_base)} rows in {time.time()-t0:.1f}s")

    t0 = time.time()
    df_full = add_features(df_base)
    print(f"  Feature engineering done ({df_full.shape[1]} cols) in {time.time()-t0:.1f}s")

    targets_full = compute_target_variants(df_full)

    total = len(args.models) * len(args.fsets) * len(args.targets)
    skip_count = sum(1 for m in args.models for f in args.fsets for t in args.targets if (m, f, t) in completed)
    print(f"\n  Grid: {len(args.models)} models × {len(args.fsets)} fsets × {len(args.targets)} targets = {total}")
    print(f"  Already done: {skip_count}, remaining: {total - skip_count}\n")

    done = 0
    for model_name in args.models:
        mod = _load_model_module(model_name)
        need_subsample = model_name in SLOW_MODELS

        # Subsample for slow models
        if need_subsample and len(df_full) > args.max_rows:
            df, sub_idx = _subsample_temporal(df_full, args.max_rows)
            targets = {k: v[sub_idx] for k, v in targets_full.items()}
            print(f"  [{model_name}] Subsampled to {len(df)} rows for speed")
        else:
            df = df_full
            targets = targets_full

        for fset_name in args.fsets:
            feature_cols = FEATURE_SETS[fset_name]
            for target_name in args.targets:
                done += 1
                is_mc, desc = TARGET_META[target_name]
                tag = f"[{done}/{total}] {model_name} | {fset_name} | {target_name}"

                if (model_name, fset_name, target_name) in completed:
                    print(f"\n--- {tag} --- SKIP (already done)")
                    continue

                print(f"\n--- {tag} ---")

                try:
                    df["_target"] = targets[target_name]
                    unique_labels = np.unique(df["_target"].dropna())
                    if len(unique_labels) < 2:
                        print(f"  SKIP: only {len(unique_labels)} class(es)")
                        continue

                    X, y = prepare_Xy(df, feature_cols, target_col="_target")
                    label_map = None
                    if is_mc and y.min() < 0:
                        unique_sorted = np.array(sorted(np.unique(y)))
                        label_map = {old: new for new, old in enumerate(unique_sorted)}
                        inv_map = {new: old for old, new in label_map.items()}
                        y = np.array([label_map[v] for v in y])

                    X_train, X_test, y_train, y_test = temporal_split(X, y, train_frac=0.8, embargo_rows=30)
                    if len(X_test) < 50:
                        print(f"  SKIP: test set too small ({len(X_test)})")
                        continue

                    scaler = StandardScaler()
                    X_train_s = scaler.fit_transform(X_train)
                    X_test_s = scaler.transform(X_test)

                    sw = compute_sample_weights(y_train)

                    class_labels = tuple(sorted(np.unique(y)))
                    n_classes = len(class_labels)
                    extra_params = {}
                    if is_mc and model_name == "XGBoost":
                        extra_params["num_class"] = n_classes
                    if is_mc and model_name == "LightGBM":
                        extra_params["num_class"] = n_classes
                    model = mod.make_model(is_multiclass=is_mc, **extra_params)

                    val_split = int(len(X_train_s) * 0.9)
                    X_tr = X_train_s[:val_split]
                    y_tr = y_train[:val_split]
                    X_vl = X_train_s[val_split:]
                    y_vl = y_train[val_split:]
                    sw_tr = sw[:val_split]

                    t0 = time.time()
                    mod.train(model, X_tr, y_tr, X_val=X_vl, y_val=y_vl, sample_weight=sw_tr)
                    train_time = time.time() - t0

                    y_pred = model.predict(X_test_s)
                    y_proba = model.predict_proba(X_test_s)

                    if label_map is not None:
                        y_pred = np.array([inv_map[v] for v in y_pred])
                        y_test = np.array([inv_map[v] for v in y_test])
                        class_labels = tuple(sorted(inv_map.values()))

                    result = evaluate_model(
                        y_true=y_test,
                        y_pred=y_pred,
                        y_proba_all=y_proba,
                        class_labels=class_labels,
                        model_name=model_name,
                        feature_set=fset_name,
                        target_name=target_name,
                        is_multiclass=is_mc,
                    )
                    result["train_time_s"] = round(train_time, 2)
                    result["n_features"] = len(feature_cols)
                    result["n_train"] = len(X_train_s)

                    log_result(result)
                    print_result(result)
                    completed.add((model_name, fset_name, target_name))

                except Exception as e:
                    print(f"  ERROR: {e}")
                    traceback.print_exc()
                    continue

    print("\n" + "=" * 70)
    print("  GRID COMPLETE — Top results by prec@0.7:")
    print("=" * 70)
    print_top_results(n=20, sort_by="prec@0.7")


if __name__ == "__main__":
    main()
