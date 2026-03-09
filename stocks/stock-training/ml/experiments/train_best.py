#!/usr/bin/env python3
"""
train_best.py — Train the best model with tuned hyperparameters.
Reads best_params.json from tuning, trains on full training set, saves to best_model/.

Usage:
  cd stock-training/ml
  python -m experiments.train_best
  python -m experiments.train_best --rank 1        # train only the #1 config
"""

import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.data_loader import load_base_df, temporal_split, prepare_Xy
from experiments.feature_engineer import add_features, FEATURE_SETS
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.evaluator import evaluate_model, print_result, RESULTS_DIR
from experiments.run_grid import compute_sample_weights

BEST_MODEL_DIR = RESULTS_DIR / "best_model"
BEST_MODEL_DIR.mkdir(exist_ok=True)
TUNED_PARAMS_PATH = RESULTS_DIR / "tuned_params.json"


def train_best(rank: int = 1):
    if not TUNED_PARAMS_PATH.exists():
        print(f"No tuned_params.json found. Run tune_focused.py first.")
        return

    with open(TUNED_PARAMS_PATH) as f:
        all_best = json.load(f)

    # Sort by cv_prec07 descending, pick by rank
    all_best.sort(key=lambda x: x.get("cv_prec07", 0), reverse=True)
    if rank < 1 or rank > len(all_best):
        print(f"Rank {rank} not found (have {len(all_best)} configs)")
        return
    cfg = all_best[rank - 1]

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
    df["_target"] = targets[target_name]

    feature_cols = FEATURE_SETS[fset_name]
    X, y = prepare_Xy(df, feature_cols, target_col="_target")

    # Remap if needed
    label_map = None
    inv_map = None
    if is_mc and y.min() < 0:
        unique_sorted = np.array(sorted(np.unique(y)))
        label_map = {old: new for new, old in enumerate(unique_sorted)}
        inv_map = {new: old for old, new in label_map.items()}
        y = np.array([label_map[v] for v in y])

    X_train, X_test, y_train, y_test = temporal_split(X, y, train_frac=0.8, embargo_rows=30)

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)
    sw = compute_sample_weights(y_train)

    # Build model with tuned params
    if model_name == "XGBoost":
        from xgboost import XGBClassifier
        base_params = {
            "random_state": 42, "n_jobs": -1, "tree_method": "hist",
            "use_label_encoder": False,
            "eval_metric": "mlogloss" if is_mc else "logloss",
            "objective": "multi:softprob" if is_mc else "binary:logistic",
        }
        base_params.update(params)
        model = XGBClassifier(**base_params)
    elif model_name == "LightGBM":
        from lightgbm import LGBMClassifier
        base_params = {
            "random_state": 42, "n_jobs": -1, "verbose": -1,
            "objective": "multiclass" if is_mc else "binary",
            "metric": "multi_logloss" if is_mc else "binary_logloss",
        }
        base_params.update(params)
        model = LGBMClassifier(**base_params)
    elif model_name == "CatBoost":
        from catboost import CatBoostClassifier
        base_params = {
            "random_seed": 42, "verbose": 0,
            "auto_class_weights": "Balanced",
            "loss_function": "MultiClass" if is_mc else "Logloss",
        }
        base_params.update(params)
        model = CatBoostClassifier(**base_params)
    elif model_name == "RandomForest":
        from sklearn.ensemble import RandomForestClassifier
        base_params = {"class_weight": "balanced", "random_state": 42, "n_jobs": -1}
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
            X_train_s[:val_split], y_train[:val_split],
            sample_weight=sw[:val_split],
            eval_set=[(X_train_s[val_split:], y_train[val_split:])],
            verbose=False,
        )
    except TypeError:
        model.fit(X_train_s, y_train, sample_weight=sw)

    # Evaluate on test
    y_pred = model.predict(X_test_s)
    y_proba = model.predict_proba(X_test_s)

    class_labels = tuple(sorted(np.unique(y)))
    if inv_map:
        y_pred = np.array([inv_map[v] for v in y_pred])
        y_test = np.array([inv_map[v] for v in y_test])
        class_labels = tuple(sorted(inv_map.values()))

    result = evaluate_model(
        y_test, y_pred, y_proba, class_labels,
        f"BEST_{model_name}_tuned", fset_name, target_name, is_mc,
    )
    print_result(result)

    # Save model
    model_path = BEST_MODEL_DIR / "model.joblib"
    scaler_path = BEST_MODEL_DIR / "scaler.joblib"
    meta_path = BEST_MODEL_DIR / "meta.json"

    joblib.dump(model, model_path)
    joblib.dump(scaler, scaler_path)

    meta = {
        "model_name": model_name,
        "feature_set": fset_name,
        "target": target_name,
        "is_multiclass": is_mc,
        "feature_columns": feature_cols,
        "class_labels": [int(c) for c in class_labels],
        "tuned_params": params,
        "tuned_cv_prec07": tuned_score,
        "test_metrics": {k: v for k, v in result.items()
                        if isinstance(v, (int, float, str, bool))},
    }
    if label_map:
        meta["label_map"] = {str(k): int(v) for k, v in label_map.items()}
        meta["inv_label_map"] = {str(k): int(v) for k, v in inv_map.items()}

    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\nModel saved to {BEST_MODEL_DIR}/")
    print(f"  model.joblib, scaler.joblib, meta.json")
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rank", type=int, default=1)
    args = parser.parse_args()
    train_best(rank=args.rank)


if __name__ == "__main__":
    main()
