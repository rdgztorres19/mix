#!/usr/bin/env python3
"""
tune_top.py — Optuna hyperparameter tuning for the top N configurations.
Reads grid_results.csv, selects the best combos, and runs Bayesian optimization.

Usage:
  cd stock-training/ml
  python -m experiments.tune_top                   # tune top 3 by prec@0.7
  python -m experiments.tune_top --top 5           # tune top 5
  python -m experiments.tune_top --trials 200      # 200 trials per config
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import optuna
import pandas as pd
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.data_loader import load_base_df, temporal_split, prepare_Xy
from experiments.feature_engineer import add_features, FEATURE_SETS
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.evaluator import (
    evaluate_model, log_result, print_result, load_grid_results,
    precision_at_threshold, RESULTS_DIR,
)
from experiments.run_grid import compute_sample_weights

optuna.logging.set_verbosity(optuna.logging.WARNING)

BEST_PARAMS_PATH = RESULTS_DIR / "best_params.json"


def _walk_forward_score(model_factory, X, y, n_splits=3, embargo=30):
    """
    Walk-forward temporal CV.
    Returns mean precision@0.7 for class 1 across splits.
    """
    n = len(X)
    fold_size = n // (n_splits + 1)
    scores = []

    for i in range(n_splits):
        train_end = fold_size * (i + 1)
        test_start = train_end + embargo
        test_end = min(test_start + fold_size, n)
        if test_end <= test_start + 50:
            continue

        X_tr = X[:train_end]
        y_tr = y[:train_end]
        X_te = X[test_start:test_end]
        y_te = y[test_start:test_end]

        scaler = StandardScaler()
        X_tr_s = scaler.fit_transform(X_tr)
        X_te_s = scaler.transform(X_te)
        sw = compute_sample_weights(y_tr)

        model = model_factory()
        val_split = int(len(X_tr_s) * 0.9)
        try:
            if hasattr(model, 'fit'):
                # Try with eval_set for boosting models
                try:
                    model.fit(
                        X_tr_s[:val_split], y_tr[:val_split],
                        sample_weight=sw[:val_split],
                        eval_set=[(X_tr_s[val_split:], y_tr[val_split:])],
                        verbose=False,
                    )
                except TypeError:
                    model.fit(X_tr_s, y_tr, sample_weight=sw)
        except Exception:
            model.fit(X_tr_s, y_tr, sample_weight=sw)

        y_proba = model.predict_proba(X_te_s)
        classes = model.classes_
        if 1 in classes:
            idx_1 = list(classes).index(1)
            proba_1 = y_proba[:, idx_1]
            prec, n_sig = precision_at_threshold(y_te, proba_1, 0.7, bullish_class=1)
            # Penalize if too few signals
            if n_sig < 20:
                prec *= 0.5
            scores.append(prec)
        else:
            scores.append(0.0)

    return np.mean(scores) if scores else 0.0


def _make_xgboost_objective(X, y, is_mc, n_splits):
    from xgboost import XGBClassifier

    def objective(trial):
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 100, 800),
            "max_depth": trial.suggest_int("max_depth", 3, 10),
            "learning_rate": trial.suggest_float("learning_rate", 0.005, 0.3, log=True),
            "subsample": trial.suggest_float("subsample", 0.5, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.3, 1.0),
            "min_child_weight": trial.suggest_int("min_child_weight", 1, 30),
            "gamma": trial.suggest_float("gamma", 0.0, 5.0),
            "reg_alpha": trial.suggest_float("reg_alpha", 1e-4, 10.0, log=True),
            "reg_lambda": trial.suggest_float("reg_lambda", 1e-4, 10.0, log=True),
            "random_state": 42,
            "n_jobs": -1,
            "tree_method": "hist",
            "use_label_encoder": False,
            "eval_metric": "mlogloss" if is_mc else "logloss",
            "objective": "multi:softprob" if is_mc else "binary:logistic",
        }

        def factory():
            return XGBClassifier(**params)

        return _walk_forward_score(factory, X, y, n_splits)

    return objective


def _make_lightgbm_objective(X, y, is_mc, n_splits):
    from lightgbm import LGBMClassifier

    def objective(trial):
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 100, 800),
            "max_depth": trial.suggest_int("max_depth", 3, 12),
            "learning_rate": trial.suggest_float("learning_rate", 0.005, 0.3, log=True),
            "subsample": trial.suggest_float("subsample", 0.5, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.3, 1.0),
            "min_child_samples": trial.suggest_int("min_child_samples", 5, 100),
            "reg_alpha": trial.suggest_float("reg_alpha", 1e-4, 10.0, log=True),
            "reg_lambda": trial.suggest_float("reg_lambda", 1e-4, 10.0, log=True),
            "num_leaves": trial.suggest_int("num_leaves", 15, 127),
            "random_state": 42,
            "n_jobs": -1,
            "verbose": -1,
            "objective": "multiclass" if is_mc else "binary",
            "metric": "multi_logloss" if is_mc else "binary_logloss",
        }

        def factory():
            return LGBMClassifier(**params)

        return _walk_forward_score(factory, X, y, n_splits)

    return objective


def _make_catboost_objective(X, y, is_mc, n_splits):
    from catboost import CatBoostClassifier

    def objective(trial):
        params = {
            "iterations": trial.suggest_int("iterations", 100, 800),
            "depth": trial.suggest_int("depth", 3, 10),
            "learning_rate": trial.suggest_float("learning_rate", 0.005, 0.3, log=True),
            "l2_leaf_reg": trial.suggest_float("l2_leaf_reg", 1e-2, 10.0, log=True),
            "bagging_temperature": trial.suggest_float("bagging_temperature", 0.0, 5.0),
            "random_strength": trial.suggest_float("random_strength", 0.0, 5.0),
            "border_count": trial.suggest_int("border_count", 32, 255),
            "random_seed": 42,
            "verbose": 0,
            "auto_class_weights": "Balanced",
            "loss_function": "MultiClass" if is_mc else "Logloss",
        }

        def factory():
            return CatBoostClassifier(**params)

        return _walk_forward_score(factory, X, y, n_splits)

    return objective


def _make_rf_objective(X, y, is_mc, n_splits):
    from sklearn.ensemble import RandomForestClassifier

    def objective(trial):
        params = {
            "n_estimators": trial.suggest_int("n_estimators", 100, 800),
            "max_depth": trial.suggest_int("max_depth", 4, 20),
            "min_samples_leaf": trial.suggest_int("min_samples_leaf", 2, 50),
            "min_samples_split": trial.suggest_int("min_samples_split", 2, 50),
            "max_features": trial.suggest_categorical("max_features", ["sqrt", "log2", 0.3, 0.5]),
            "class_weight": "balanced",
            "random_state": 42,
            "n_jobs": -1,
        }

        def factory():
            return RandomForestClassifier(**params)

        return _walk_forward_score(factory, X, y, n_splits)

    return objective


OBJECTIVE_MAKERS = {
    "XGBoost": _make_xgboost_objective,
    "LightGBM": _make_lightgbm_objective,
    "CatBoost": _make_catboost_objective,
    "RandomForest": _make_rf_objective,
}


def tune_top_configs(top_n=3, n_trials=100, n_splits=3, sort_by="prec@0.7"):
    """Tune the top N configurations from grid results."""
    df = load_grid_results()
    if df.empty:
        print("No grid results. Run run_grid.py first.")
        return

    for c in [sort_by]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=[sort_by])
    top = df.nlargest(top_n, sort_by)

    print(f"\n{'='*70}")
    print(f"  HYPERPARAMETER TUNING — Top {top_n} by {sort_by}")
    print(f"  {n_trials} trials each, {n_splits}-fold walk-forward CV")
    print(f"{'='*70}")

    # Load data once
    df_base = load_base_df()
    df_data = add_features(df_base)
    targets = compute_target_variants(df_data)

    all_best = []

    for rank, (_, row) in enumerate(top.iterrows(), 1):
        model_name = row["model"]
        fset_name = row["feature_set"]
        target_name = row["target"]
        is_mc = TARGET_META[target_name][0]
        baseline = row[sort_by]

        print(f"\n--- [{rank}/{top_n}] {model_name} | {fset_name} | {target_name} (baseline {sort_by}={baseline:.4f}) ---")

        if model_name not in OBJECTIVE_MAKERS:
            print(f"  SKIP: no objective maker for {model_name}")
            continue

        # Prepare data
        feature_cols = FEATURE_SETS[fset_name]
        df_data["_target"] = targets[target_name]
        X, y = prepare_Xy(df_data, feature_cols, target_col="_target")

        # Remap if multiclass with negative labels
        label_map = None
        if is_mc and y.min() < 0:
            unique_sorted = np.array(sorted(np.unique(y)))
            label_map = {old: new for new, old in enumerate(unique_sorted)}
            y = np.array([label_map[v] for v in y])

        # Use only training portion for CV
        n = len(X)
        train_end = int(n * 0.8)
        X_train_full = X.iloc[:train_end]
        y_train_full = y[:train_end]

        # Create objective
        make_obj = OBJECTIVE_MAKERS[model_name]
        objective = make_obj(X_train_full.values, y_train_full, is_mc, n_splits)

        # Run Optuna
        study = optuna.create_study(direction="maximize", study_name=f"{model_name}_{fset_name}_{target_name}")
        t0 = time.time()
        study.optimize(objective, n_trials=n_trials, show_progress_bar=True)
        elapsed = time.time() - t0

        best = study.best_trial
        print(f"  Best trial: value={best.value:.4f} (baseline={baseline:.4f})")
        print(f"  Improvement: {best.value - baseline:+.4f}")
        print(f"  Params: {json.dumps(best.params, indent=2, default=str)}")
        print(f"  Time: {elapsed:.0f}s")

        all_best.append({
            "rank": rank,
            "model": model_name,
            "feature_set": fset_name,
            "target": target_name,
            "baseline_score": round(float(baseline), 4),
            "tuned_score": round(float(best.value), 4),
            "improvement": round(float(best.value - baseline), 4),
            "best_params": best.params,
        })

    # Save all results
    with open(BEST_PARAMS_PATH, "w") as f:
        json.dump(all_best, f, indent=2, default=str)
    print(f"\nBest params saved to {BEST_PARAMS_PATH}")

    # Summary
    print(f"\n{'='*70}")
    print("  TUNING SUMMARY")
    print(f"{'='*70}")
    for b in all_best:
        print(f"  {b['model']} | {b['feature_set']} | {b['target']}: "
              f"baseline={b['baseline_score']:.4f} → tuned={b['tuned_score']:.4f} "
              f"({b['improvement']:+.4f})")

    return all_best


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--top", type=int, default=3)
    parser.add_argument("--trials", type=int, default=100)
    parser.add_argument("--splits", type=int, default=3)
    parser.add_argument("--sort-by", default="prec@0.7")
    args = parser.parse_args()
    tune_top_configs(top_n=args.top, n_trials=args.trials, n_splits=args.splits, sort_by=args.sort_by)


if __name__ == "__main__":
    main()
