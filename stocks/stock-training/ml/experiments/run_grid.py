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
    csv_path: str | None = None,
    max_rows: int = 0,
):
    print("=" * 70)
    print("  EXPERIMENT GRID — Loading data")
    print("=" * 70)

    # 1. Load CSV + features (filter valid rows if available)
    from experiments.data_loader import load_df_with_features, load_base_df
    from experiments.feature_engineer import add_features as _add_features
    import time as _time

    if csv_path:
        csv_p = Path(csv_path)
        if not csv_p.is_absolute():
            csv_p = Path(__file__).resolve().parent.parent.parent / csv_path
        print(f"  Loading custom CSV: {csv_p}")
        t0 = _time.time()
        df = pd.read_csv(csv_p, low_memory=False)
        if max_rows and len(df) > max_rows:
            df = df.tail(max_rows).reset_index(drop=True)
            print(f"  Trimmed to last {max_rows} rows")
        print(f"  Loaded {len(df)} rows in {_time.time() - t0:.1f}s")
        print(f"  Adding features...")
        t0 = _time.time()
        df = _add_features(df)
        print(f"  Features done ({df.shape[1]} cols) in {_time.time() - t0:.1f}s")
        if "valid_for_training" in df.columns:
            n_before = len(df)
            df = df[df["valid_for_training"] == 1].reset_index(drop=True)
            print(f"  Filtered valid: {n_before} → {len(df)}")
    else:
        df = load_df_with_features(filter_valid=True)

    # 2. Compute all target variants
    import gc
    targets = compute_target_variants(df)
    gc.collect()

    # 3. If targets_filter is set, drop unused targets to save memory
    if targets_filter:
        keep = set(targets_filter)
        for k in list(targets.keys()):
            if k not in keep:
                del targets[k]
        gc.collect()
        print(f"  Kept {len(targets)} targets (freed unused)")

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

    # ── Train one combo ─────────────────────────────────────────────────
    import os
    MAX_PARALLEL = 4
    n_cores = os.cpu_count() or 8
    jobs_per_model = max(1, n_cores // MAX_PARALLEL)

    def _run_one_combo(model_name, fset_name, target_name, combo_idx):
        is_mc, desc = TARGET_META[target_name]
        tag = f"[{combo_idx}/{total}] {model_name} | {fset_name} | {target_name}"

        if (model_name, fset_name, target_name) in completed:
            return None

        try:
            if target_name not in targets:
                return None

            bundle = targets[target_name]
            if not isinstance(bundle, dict) or "y" not in bundle or "valid" not in bundle:
                return None

            y_full = np.asarray(bundle["y"])
            valid_mask = np.asarray(bundle["valid"]).astype(bool)

            if len(y_full) != len(df) or len(valid_mask) != len(df):
                return None

            df_target = df.loc[valid_mask].copy()
            if len(df_target) == 0:
                return None

            df_target["_target"] = y_full[valid_mask]

            unique_labels = np.unique(df_target["_target"])
            if len(unique_labels) < 2:
                return None

            feature_cols = FEATURE_SETS[fset_name]
            X, y = prepare_Xy(df_target, feature_cols, target_col="_target")

            if len(X) == 0 or len(y) == 0:
                return None

            if len(np.unique(y)) < 2:
                return None

            label_map = None
            inv_map = None
            if is_mc and y.min() < 0:
                unique_sorted = np.array(sorted(np.unique(y)))
                label_map = {old: new for new, old in enumerate(unique_sorted)}
                inv_map = {new: old for old, new in label_map.items()}
                y = np.array([label_map[v] for v in y])

            X_train, X_test, y_train, y_test = temporal_split(X, y, train_frac=0.8, embargo_rows=30)

            if len(X_test) < 50 or len(np.unique(y_train)) < 2 or len(np.unique(y_test)) < 2:
                return None

            use_scaler = not fset_name.startswith("V2")
            if use_scaler:
                scaler = StandardScaler()
                X_train_s = scaler.fit_transform(X_train)
                X_test_s = scaler.transform(X_test)
            else:
                X_train_s = X_train.values if hasattr(X_train, 'values') else X_train
                X_test_s = X_test.values if hasattr(X_test, 'values') else X_test

            sw = compute_sample_weights(y_train)

            class_labels = tuple(sorted(np.unique(y)))
            n_classes = len(class_labels)
            extra_params = {}
            if is_mc and model_name in ("XGBoost", "LightGBM"):
                extra_params["num_class"] = n_classes

            # Load model module and build with limited n_jobs
            mod = _load_model_module(model_name)
            model = mod.make_model(is_multiclass=is_mc, n_jobs=jobs_per_model, **extra_params)

            val_split = int(len(X_train_s) * 0.9)
            if val_split <= 0 or val_split >= len(X_train_s):
                return None

            X_tr, y_tr = X_train_s[:val_split], y_train[:val_split]
            X_vl, y_vl = X_train_s[val_split:], y_train[val_split:]
            sw_tr = sw[:val_split]

            if len(X_vl) == 0:
                return None

            t0 = time.time()
            mod.train(model, X_tr, y_tr, X_val=X_vl, y_val=y_vl, sample_weight=sw_tr)
            train_time = time.time() - t0

            y_pred = model.predict(X_test_s)
            y_proba = model.predict_proba(X_test_s)

            if label_map is not None and inv_map is not None:
                y_pred = np.array([inv_map[v] for v in y_pred])
                y_test = np.array([inv_map[v] for v in y_test])
                class_labels = tuple(sorted(inv_map.values()))

            result = evaluate_model(
                y_true=y_test, y_pred=y_pred, y_proba_all=y_proba,
                class_labels=class_labels, model_name=model_name,
                feature_set=fset_name, target_name=target_name, is_multiclass=is_mc,
            )
            result["train_time_s"] = round(train_time, 2)
            result["n_features"] = len(feature_cols)
            result["n_train"] = len(X_train_s)
            result["n_valid_target_rows"] = int(valid_mask.sum())
            result["target_desc"] = desc

            log_result(result)
            print(f"\n  ✓ {tag} — prec@0.7={result.get('prec@0.7', 0):.4f} ({train_time:.1f}s)")
            return result

        except Exception as e:
            print(f"\n  ✗ {tag} — ERROR: {e}")
            traceback.print_exc()
            return None

    # ── Run combos in parallel ────────────────────────────────────────

    from concurrent.futures import ThreadPoolExecutor, as_completed

    combos = []
    idx = 0
    for model_name in model_names:
        for fset_name in fset_names:
            for target_name in target_names:
                idx += 1
                if (model_name, fset_name, target_name) not in completed:
                    combos.append((model_name, fset_name, target_name, idx))

    print(f"\n  Running {len(combos)} combos with up to {MAX_PARALLEL} in parallel (n_jobs={jobs_per_model})\n")

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as executor:
        futures = {executor.submit(_run_one_combo, m, f, t, i): (m, f, t) for m, f, t, i in combos}
        for fut in as_completed(futures):
            try:
                fut.result()
            except Exception as e:
                m, f, t = futures[fut]
                print(f"  ERROR {m}|{f}|{t}: {e}")

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
    parser.add_argument("--csv", default=None, help="Path to custom CSV (e.g. with news features)")
    parser.add_argument("--max-rows", type=int, default=0, help="Max rows to load (0=all)")
    args = parser.parse_args()

    run_grid(
        models_filter=args.models,
        fsets_filter=args.fsets,
        targets_filter=args.targets,
        quick=args.quick,
        csv_path=args.csv,
        max_rows=args.max_rows,
    )


if __name__ == "__main__":
    main()