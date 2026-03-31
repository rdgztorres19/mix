#!/usr/bin/env python3
"""
train_best.py — Train models with tuned hyperparameters.
Reads tuned_params.json from tuning, trains on full training set.
Saves to best_models/{model}_{feature_set}_{target}/.

Usage:
  cd stock-training/ml

  # desde ml/
  python -m experiments.train_best
  python -m experiments.train_best --rank 2
  python -m experiments.train_best --all

  # o si estás dentro de ml/experiments
  python train_best.py --all
"""

import argparse
import json
import re
import sys
from pathlib import Path

import joblib
import numpy as np
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.data_loader import temporal_split, prepare_Xy
from experiments.feature_engineer import FEATURE_SETS
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.evaluator import evaluate_model, print_result, RESULTS_DIR
from experiments.run_grid import compute_sample_weights

BEST_MODELS_DIR = RESULTS_DIR / "best_models"
BEST_MODELS_DIR.mkdir(exist_ok=True)
TUNED_PARAMS_PATH = RESULTS_DIR / "tuned_params.json"


def _safe_dir_name(s: str) -> str:
    """Sanitize string for use in directory name."""
    return re.sub(r"[^\w\-]", "_", s)


def _extract_target_arrays(target_obj):
    """
    Supports both old format:
      np.ndarray

    and new format:
      {"y": np.ndarray, "valid": np.ndarray}
    """
    if isinstance(target_obj, dict):
        y = np.asarray(target_obj["y"])
        valid = np.asarray(target_obj["valid"], dtype=bool)
    else:
        y = np.asarray(target_obj)
        valid = np.ones(len(y), dtype=bool)
    return y, valid


def train_best(rank: int | None = 1, train_all: bool = False):
    if not TUNED_PARAMS_PATH.exists():
        print("No tuned_params.json found. Run tune_focused.py first.")
        return

    with open(TUNED_PARAMS_PATH) as f:
        all_best = json.load(f)

    # Sort by cv_prec07 descending
    all_best.sort(key=lambda x: x.get("cv_prec07", 0), reverse=True)

    if train_all:
        configs_to_train = list(enumerate(all_best, start=1))
    else:
        if rank is None or rank < 1 or rank > len(all_best):
            print(f"Rank {rank} not found (have {len(all_best)} configs)")
            return
        configs_to_train = [(rank, all_best[rank - 1])]

    # Load data ONCE (cached), share across all configs
    print("Loading data (once)...")
    import time
    from experiments.data_loader import load_df_with_features
    t0 = time.time()
    df = load_df_with_features()
    targets = compute_target_variants(df)
    print(f"  Data ready: {len(df)} rows in {time.time() - t0:.1f}s")

    MAX_PARALLEL = 4
    n_cores = __import__('os').cpu_count() or 8
    jobs_per_model = max(1, n_cores // MAX_PARALLEL)

    if train_all and len(configs_to_train) > 1:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        print(f"\n  Training {len(configs_to_train)} models, up to {MAX_PARALLEL} in parallel (n_jobs={jobs_per_model})\n")

        with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as executor:
            futures = {}
            for r, cfg in configs_to_train:
                fut = executor.submit(_train_one, cfg, rank=r, shared_df=df, shared_targets=targets, n_jobs_override=jobs_per_model)
                futures[fut] = (r, cfg)

            for fut in as_completed(futures):
                r, cfg = futures[fut]
                try:
                    fut.result()
                except Exception as e:
                    print(f"  ERROR training rank #{r} {cfg['model']}|{cfg['feature_set']}|{cfg['target']}: {e}")
    else:
        for r, cfg in configs_to_train:
            _train_one(cfg, rank=r, shared_df=df, shared_targets=targets)

    if train_all:
        print(f"\nAll {len(configs_to_train)} models saved to {BEST_MODELS_DIR}/")


def _train_one(cfg: dict, rank: int = 1, shared_df=None, shared_targets=None, n_jobs_override=None):
    model_name = cfg["model"]
    fset_name = cfg["feature_set"]
    target_name = cfg["target"]
    params = cfg["best_params"].copy()
    tuned_score = cfg.get("cv_prec07", 0)
    is_mc = TARGET_META[target_name][0]

    print(f"\n{'='*70}")
    print(f"  TRAINING BEST MODEL — Rank #{rank}")
    print(f"  {model_name} | {fset_name} | {target_name}")
    print(f"  Tuned CV prec@0.7: {tuned_score:.4f}")
    print(f"{'='*70}")

    # Use shared data if provided, otherwise load fresh
    if shared_df is not None and shared_targets is not None:
        df = shared_df
        targets = shared_targets
    else:
        from experiments.data_loader import load_df_with_features
        df = load_df_with_features()
        targets = compute_target_variants(df)

    target_info = targets[target_name]
    target_y, target_valid = _extract_target_arrays(target_info)

    df = df.copy()
    df["_target"] = target_y
    df = df.loc[target_valid].copy()

    if len(df) == 0:
        print("SKIP: target valid mask removed all rows")
        return

    if df["_target"].nunique(dropna=True) < 2:
        print("SKIP: target has less than 2 classes after valid filtering")
        return

    feature_cols = FEATURE_SETS[fset_name]
    X, y = prepare_Xy(df, feature_cols, target_col="_target")

    if len(y) == 0:
        print("SKIP: 0 rows after prepare_Xy")
        return

    # Remap if needed
    label_map = None
    inv_map = None
    if is_mc and y.min() < 0:
        unique_sorted = np.array(sorted(np.unique(y)))
        label_map = {old: new for new, old in enumerate(unique_sorted)}
        inv_map = {new: old for old, new in label_map.items()}
        y = np.array([label_map[v] for v in y], dtype=np.int32)

    X_train, X_test, y_train, y_test = temporal_split(X, y, train_frac=0.8, embargo_rows=30)

    if len(np.unique(y_train)) < 2:
        print("SKIP: y_train has less than 2 classes")
        return

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)
    sw = compute_sample_weights(y_train)

    # Build model with tuned params
    if model_name == "XGBoost":
        from xgboost import XGBClassifier

        base_params = {
            "random_state": 42,
            "n_jobs": n_jobs_override or -1,
            "tree_method": "hist",
            "eval_metric": "mlogloss" if is_mc else "logloss",
            "objective": "multi:softprob" if is_mc else "binary:logistic",
        }
        if is_mc:
            base_params["num_class"] = int(len(np.unique(y_train)))
        base_params.update(params)
        model = XGBClassifier(**base_params)

    elif model_name == "LightGBM":
        from lightgbm import LGBMClassifier

        base_params = {
            "random_state": 42,
            "n_jobs": n_jobs_override or -1,
            "verbose": -1,
            "objective": "multiclass" if is_mc else "binary",
            "metric": "multi_logloss" if is_mc else "binary_logloss",
        }
        if is_mc:
            base_params["num_class"] = int(len(np.unique(y_train)))
        base_params.update(params)
        model = LGBMClassifier(**base_params)

    elif model_name == "CatBoost":
        from catboost import CatBoostClassifier

        base_params = {
            "random_seed": 42,
            "verbose": 0,
            "auto_class_weights": "Balanced",
            "loss_function": "MultiClass" if is_mc else "Logloss",
        }
        base_params.update(params)
        model = CatBoostClassifier(**base_params)

    elif model_name == "RandomForest":
        from sklearn.ensemble import RandomForestClassifier

        base_params = {
            "class_weight": "balanced",
            "random_state": 42,
            "n_jobs": n_jobs_override or -1,
        }
        base_params.update(params)
        model = RandomForestClassifier(**base_params)

    else:
        print(f"Unknown model: {model_name}")
        return

    # Train
    print("Training...")
    val_split = int(len(X_train_s) * 0.9)

    try:
        model.fit(
            X_train_s[:val_split],
            y_train[:val_split],
            sample_weight=sw[:val_split],
            eval_set=[(X_train_s[val_split:], y_train[val_split:])],
            verbose=False,
        )
    except TypeError:
        try:
            model.fit(
                X_train_s[:val_split],
                y_train[:val_split],
                sample_weight=sw[:val_split],
                eval_set=[(X_train_s[val_split:], y_train[val_split:])],
            )
        except TypeError:
            model.fit(X_train_s, y_train, sample_weight=sw)

    # Evaluate on test
    y_pred = model.predict(X_test_s)
    y_proba = model.predict_proba(X_test_s)

    class_labels = tuple(sorted(np.unique(y)))

    if inv_map:
        y_pred = np.array([inv_map[int(v)] for v in y_pred])
        y_test = np.array([inv_map[int(v)] for v in y_test])
        class_labels = tuple(sorted(inv_map.values()))

    result = evaluate_model(
        y_test,
        y_pred,
        y_proba,
        class_labels,
        f"BEST_{model_name}_tuned",
        fset_name,
        target_name,
        is_mc,
    )
    print_result(result)

    # Save to best_models/{model}_{feature_set}_{target}/
    subdir = _safe_dir_name(f"{model_name}_{fset_name}_{target_name}")
    output_dir = BEST_MODELS_DIR / subdir
    output_dir.mkdir(parents=True, exist_ok=True)

    use_scaler = not fset_name.startswith("V2")

    joblib.dump(model, output_dir / "model.joblib")
    if use_scaler:
        joblib.dump(scaler, output_dir / "scaler.joblib")

    meta = {
        "model_name": model_name,
        "feature_set": fset_name,
        "target": target_name,
        "is_multiclass": is_mc,
        "use_scaler": use_scaler,
        "feature_columns": feature_cols,
        "class_labels": [int(c) for c in class_labels],
        "tuned_params": params,
        "tuned_cv_prec07": tuned_score,
        "test_metrics": {
            k: v
            for k, v in result.items()
            if isinstance(v, (int, float, str, bool))
        },
    }

    if label_map:
        meta["label_map"] = {str(k): int(v) for k, v in label_map.items()}
        meta["inv_label_map"] = {str(k): int(v) for k, v in inv_map.items()}

    with open(output_dir / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nModel saved to {output_dir}/")
    print("  model.joblib, scaler.joblib, meta.json")
    return result


def train_from_grid(configs: list[tuple[str, str, str]]):
    """
    Train models using DEFAULT hyperparameters (same as run_grid.py).
    No tuning needed — uses the combos that already performed well in the grid.
    """
    import os
    os.environ.setdefault("TRAINING_MAX_ROWS", "5000000")

    print("Loading data (once)...")
    import time
    from experiments.data_loader import load_df_with_features
    t0 = time.time()
    df = load_df_with_features(filter_valid=True)
    targets = compute_target_variants(df)
    print(f"  Data ready: {len(df)} rows in {time.time() - t0:.1f}s")

    MAX_PARALLEL = 4
    n_cores = __import__('os').cpu_count() or 8
    jobs_per_model = max(1, n_cores // MAX_PARALLEL)

    # Build cfg dicts with empty params (will use model defaults)
    cfg_list = []
    for i, (model_name, fset_name, target_name) in enumerate(configs, 1):
        cfg_list.append((i, {
            "model": model_name,
            "feature_set": fset_name,
            "target": target_name,
            "best_params": {},  # empty = use model defaults
            "cv_prec07": 0,
        }))

    from concurrent.futures import ThreadPoolExecutor, as_completed
    print(f"\n  Training {len(cfg_list)} models from grid defaults, up to {MAX_PARALLEL} in parallel\n")

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as executor:
        futures = {}
        for r, cfg in cfg_list:
            fut = executor.submit(_train_one, cfg, rank=r, shared_df=df, shared_targets=targets, n_jobs_override=jobs_per_model)
            futures[fut] = (r, cfg)

        for fut in as_completed(futures):
            r, cfg = futures[fut]
            try:
                fut.result()
            except Exception as e:
                print(f"  ERROR: {cfg['model']}|{cfg['feature_set']}|{cfg['target']}: {e}")

    print(f"\nAll {len(cfg_list)} models saved to {BEST_MODELS_DIR}/")


# Top configs from grid_results.csv to train with defaults
GRID_TOP_CONFIGS = [
    # Bullish: best per target
    ("LightGBM", "V2_full_bear", "bin_rr10m_ge_2"),   # 65.0% P@0.70
    ("XGBoost", "V2_full", "bin_rr10m_ge_3"),          # 57.6% P@0.70
    # Bearish: best per target
    ("XGBoost", "D_clean_ext", "bin_drop_2p0_30m"),    # 75.2% P@0.70
    ("XGBoost", "V2_full", "bin_rr10m_bearish_ge_2"),  # 66.8% P@0.70
    ("LightGBM", "V2_full", "bin_drop_2p0_10m"),       # 60.3% P@0.70
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rank", type=int, default=None, help="Train only this rank (1=best cv_prec07)")
    parser.add_argument("--all", action="store_true", help="Train all configs from tuned_params.json")
    parser.add_argument("--from-grid", action="store_true", help="Train top configs with grid defaults (no tuning)")
    args = parser.parse_args()

    if args.from_grid:
        train_from_grid(GRID_TOP_CONFIGS)
    elif args.all:
        train_best(rank=None, train_all=True)
    else:
        train_best(rank=args.rank or 1, train_all=False)


if __name__ == "__main__":
    main()