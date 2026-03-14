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

from experiments.data_loader import load_base_df, temporal_split, prepare_Xy
from experiments.feature_engineer import add_features, FEATURE_SETS
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

    for r, cfg in configs_to_train:
        _train_one(cfg, rank=r)

    if train_all:
        print(f"\nAll {len(configs_to_train)} models saved to {BEST_MODELS_DIR}/")


def _train_one(cfg: dict, rank: int = 1):
    model_name = cfg["model"]
    fset_name = cfg["feature_set"]
    target_name = cfg["target"]
    params = cfg["best_params"]
    tuned_score = cfg.get("cv_prec07", 0)
    is_mc = TARGET_META[target_name][0]

    print(f"\n{'='*70}")
    print(f"  TRAINING BEST MODEL — Rank #{rank}")
    print(f"  {model_name} | {fset_name} | {target_name}")
    print(f"  Tuned CV prec@0.7: {tuned_score:.4f}")
    print(f"{'='*70}")

    # Load data
    df_base = load_base_df()
    df = add_features(df_base)
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
            "n_jobs": -1,
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
            "n_jobs": -1,
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
            "n_jobs": -1,
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

    joblib.dump(model, output_dir / "model.joblib")
    joblib.dump(scaler, output_dir / "scaler.joblib")

    meta = {
        "model_name": model_name,
        "feature_set": fset_name,
        "target": target_name,
        "is_multiclass": is_mc,
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rank", type=int, default=None, help="Train only this rank (1=best cv_prec07)")
    parser.add_argument("--all", action="store_true", help="Train all configs from tuned_params.json")
    args = parser.parse_args()

    if args.all:
        train_best(rank=None, train_all=True)
    else:
        train_best(rank=args.rank or 1, train_all=False)


if __name__ == "__main__":
    main()