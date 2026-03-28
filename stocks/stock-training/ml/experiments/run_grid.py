#!/usr/bin/env python3
"""
run_grid.py — Exhaustive experiment grid.
Iterates: model × feature_set × target_variant
For each combo: train → evaluate → log results.

Usage:
  cd stock-training/ml
  python -m experiments.run_grid
  python -m experiments.run_grid --models XGBoost
  python -m experiments.run_grid --quick
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

# Ensure ml/ is on path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.data_loader import load_base_df, temporal_split, prepare_Xy
from experiments.feature_engineer import add_features, FEATURE_SETS
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.evaluator import evaluate_model, log_result, print_result, print_top_results


# ---------------------------------------------------------------------------
# Skip already-completed combos
# ---------------------------------------------------------------------------
def _load_completed() -> set:
    """Return set of (model, fset, target) tuples already in grid_results.csv."""
    csv_path = Path(__file__).resolve().parent / "results" / "grid_results.csv"
    if not csv_path.exists():
        return set()
    try:
        print(f"Loading completed combos from {csv_path}")
        df = pd.read_csv(csv_path)
        return set(zip(df["model"], df["feature_set"], df["target"]))
    except Exception as e:
        print(f"Error loading completed combos: {e}")
        return set()


# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------
MODEL_MODULES = {
    "XGBoost": "experiments.models.xgb_native",
    "LightGBM": "experiments.models.lgbm_model",
    "CatBoost": "experiments.models.catboost_model",
    "RandomForest": "experiments.models.rf_optimized",
    "ExtraTrees": "experiments.models.extra_trees",
    "LogisticRegression": "experiments.models.logistic",
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
):
    print("=" * 70)
    print("  EXPERIMENT GRID — Loading data")
    print("=" * 70)

    # 1. Load base CSV
    t0 = time.time()
    df_base = load_base_df()
    print(f"  Loaded {len(df_base)} rows in {time.time() - t0:.1f}s")

    # 2. Feature engineering
    print(f"Adding features to {len(df_base)} rows")
    t0 = time.time()
    df = add_features(df_base)
    print(f"  Feature engineering done ({df.shape[1]} cols) in {time.time() - t0:.1f}s")

    # 3. Compute all target variants
    targets = compute_target_variants(df)

    # 4. Determine grid
    model_names = models_filter or list(MODEL_MODULES.keys())
    fset_names = fsets_filter or list(FEATURE_SETS.keys())
    target_names = targets_filter or list(TARGET_META.keys())

    if quick:
        model_names = [m for m in model_names if m in ("XGBoost", "LightGBM", "RandomForest")]
        fset_names = [f for f in fset_names if f in ("B_enriched", "D_all", "D_clean", "D_clean_ext")]
        target_names = [
            t for t in target_names
            if t in (
                "mc_2p5",
                "bin_mfr10m_1p5",
                "bin_fr5m_1p5",
                "bin_opportunity_clean_10m_1p5_0p5",
                "bin_rr10m_ge_2",
            )
        ]

    completed = _load_completed()
    total = len(model_names) * len(fset_names) * len(target_names)
    skipped_count = sum(
        1
        for m in model_names
        for f in fset_names
        for t in target_names
        if (m, f, t) in completed
    )

    print(f"\n  Grid: {len(model_names)} models × {len(fset_names)} fsets × {len(target_names)} targets = {total} combos")
    print(f"  Already completed: {skipped_count}, remaining: {total - skipped_count}\n")

    done = 0
    for model_name in model_names:
        mod = _load_model_module(model_name)

        for fset_name in fset_names:
            feature_cols = FEATURE_SETS[fset_name]

            for target_name in target_names:
                done += 1
                is_mc, desc = TARGET_META[target_name]
                tag = f"[{done}/{total}] {model_name} | {fset_name} | {target_name}"

                if (model_name, fset_name, target_name) in completed:
                    print(f"\n--- {tag} --- SKIP (already done)")
                    continue

                print(f"\n--- {tag} ---")

                try:
                    # ------------------------------------------------------------------
                    # NEW TARGET STRUCTURE:
                    # bundle = {"y": ..., "valid": ...}
                    # ------------------------------------------------------------------
                    if target_name not in targets:
                        print("  SKIP: target not found in computed targets")
                        continue

                    bundle = targets[target_name]
                    if not isinstance(bundle, dict) or "y" not in bundle or "valid" not in bundle:
                        print("  SKIP: target bundle has invalid format")
                        continue

                    y_full = np.asarray(bundle["y"])
                    valid_mask = np.asarray(bundle["valid"]).astype(bool)

                    if len(y_full) != len(df) or len(valid_mask) != len(df):
                        print("  SKIP: target length mismatch with dataframe")
                        continue

                    # Filter only valid rows for this target
                    df_target = df.loc[valid_mask].copy()
                    if len(df_target) == 0:
                        print("  SKIP: no valid rows for target")
                        continue

                    df_target["_target"] = y_full[valid_mask]

                    # Skip if target is all one class
                    unique_labels = np.unique(df_target["_target"])
                    if len(unique_labels) < 2:
                        print(f"  SKIP: only {len(unique_labels)} class(es) in target")
                        continue

                    # Prepare X, y
                    X, y = prepare_Xy(df_target, feature_cols, target_col="_target")

                    if len(X) == 0 or len(y) == 0:
                        print("  SKIP: empty X/y after prepare_Xy")
                        continue

                    unique_after_prepare = np.unique(y)
                    if len(unique_after_prepare) < 2:
                        print(f"  SKIP: only {len(unique_after_prepare)} class(es) after prepare_Xy")
                        continue

                    # Remap multiclass labels if needed, e.g. [-1,0,1] -> [0,1,2]
                    label_map = None
                    inv_map = None
                    if is_mc and y.min() < 0:
                        unique_sorted = np.array(sorted(np.unique(y)))
                        label_map = {old: new for new, old in enumerate(unique_sorted)}
                        inv_map = {new: old for old, new in label_map.items()}
                        y = np.array([label_map[v] for v in y])

                    # Temporal split
                    X_train, X_test, y_train, y_test = temporal_split(
                        X, y, train_frac=0.8, embargo_rows=30
                    )

                    if len(X_test) < 50:
                        print(f"  SKIP: test set too small ({len(X_test)})")
                        continue

                    if len(np.unique(y_train)) < 2:
                        print("  SKIP: training split has only one class")
                        continue

                    if len(np.unique(y_test)) < 2:
                        print("  SKIP: test split has only one class")
                        continue

                    # Scale (skip for V2 feature sets — all relative, trees don't need it)
                    use_scaler = not fset_name.startswith("V2")
                    if use_scaler:
                        scaler = StandardScaler()
                        X_train_s = scaler.fit_transform(X_train)
                        X_test_s = scaler.transform(X_test)
                    else:
                        scaler = None
                        X_train_s = X_train.values if hasattr(X_train, 'values') else X_train
                        X_test_s = X_test.values if hasattr(X_test, 'values') else X_test

                    # Class weights
                    sw = compute_sample_weights(y_train)

                    # Build model
                    class_labels = tuple(sorted(np.unique(y)))
                    n_classes = len(class_labels)
                    extra_params = {}

                    if is_mc and model_name == "XGBoost":
                        extra_params["num_class"] = n_classes
                    if is_mc and model_name == "LightGBM":
                        extra_params["num_class"] = n_classes

                    model = mod.make_model(is_multiclass=is_mc, **extra_params)

                    # Validation split for early stopping
                    val_split = int(len(X_train_s) * 0.9)
                    if val_split <= 0 or val_split >= len(X_train_s):
                        print("  SKIP: invalid validation split")
                        continue

                    X_tr = X_train_s[:val_split]
                    y_tr = y_train[:val_split]
                    X_vl = X_train_s[val_split:]
                    y_vl = y_train[val_split:]
                    sw_tr = sw[:val_split]

                    if len(X_vl) == 0 or len(y_vl) == 0:
                        print("  SKIP: empty validation set")
                        continue

                    # Train
                    t0 = time.time()
                    mod.train(model, X_tr, y_tr, X_val=X_vl, y_val=y_vl, sample_weight=sw_tr)
                    train_time = time.time() - t0

                    # Predict
                    y_pred = model.predict(X_test_s)
                    y_proba = model.predict_proba(X_test_s)

                    # Remap labels back to original values for evaluation
                    if label_map is not None and inv_map is not None:
                        y_pred = np.array([inv_map[v] for v in y_pred])
                        y_test = np.array([inv_map[v] for v in y_test])
                        class_labels = tuple(sorted(inv_map.values()))

                    # Evaluate
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
                    result["n_valid_target_rows"] = int(valid_mask.sum())
                    result["target_desc"] = desc

                    log_result(result)
                    print_result(result)

                except Exception as e:
                    print(f"  ERROR: {e}")
                    traceback.print_exc()
                    continue

    # Final summary
    print("\n" + "=" * 70)
    print("  GRID COMPLETE — Top results by prec@0.7:")
    print("=" * 70)
    print_top_results(n=20, sort_by="prec@0.7")

    print("\n  Top results by class_1_precision:")
    print_top_results(n=10, sort_by="class_1_precision")


def main():
    parser = argparse.ArgumentParser(description="Run ML experiment grid")
    parser.add_argument("--models", nargs="+", help="Filter models (e.g. XGBoost LightGBM)")
    parser.add_argument("--fsets", nargs="+", help="Filter feature sets (e.g. D_all B_enriched)")
    parser.add_argument("--targets", nargs="+", help="Filter targets (e.g. mc_2p5 bin_mfr10m_1p5)")
    parser.add_argument("--quick", action="store_true", help="Quick test with reduced grid")
    args = parser.parse_args()

    # _load_completed()

    run_grid(
        models_filter=args.models,
        fsets_filter=args.fsets,
        targets_filter=args.targets,
        quick=args.quick,
    )


if __name__ == "__main__":
    main()