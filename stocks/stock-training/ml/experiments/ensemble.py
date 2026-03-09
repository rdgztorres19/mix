#!/usr/bin/env python3
"""
ensemble.py — Voting, Stacking, and Cascading ensembles.
Uses pre-trained models from the grid or re-trains on the fly.
Run after run_grid.py to combine the top performing models.

Usage:
  cd stock-training/ml
  python -m experiments.ensemble
  python -m experiments.ensemble --top 3 --method voting stacking cascading
"""

import argparse
import sys
import importlib
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.data_loader import load_base_df, temporal_split, prepare_Xy
from experiments.feature_engineer import add_features, FEATURE_SETS
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.evaluator import (
    evaluate_model, log_result, print_result, load_grid_results, RESULTS_DIR,
)
from experiments.run_grid import _load_model_module, compute_sample_weights


def _get_top_configs(n: int = 3, sort_by: str = "prec@0.7") -> list[dict]:
    """Read grid_results.csv and return top N configs."""
    df = load_grid_results()
    if df.empty or sort_by not in df.columns:
        raise ValueError(f"No grid results or column '{sort_by}' not found. Run run_grid.py first.")
    # Exclude LogisticRegression from ensembles (baseline only)
    df = df[df["model"] != "LogisticRegression"]
    top = df.nlargest(n, sort_by)
    configs = []
    for _, row in top.iterrows():
        configs.append({
            "model": row["model"],
            "feature_set": row["feature_set"],
            "target": row["target"],
        })
    return configs


def build_ensemble(method: str = "voting", top_n: int = 3, sort_by: str = "prec@0.7"):
    """
    Build and evaluate ensemble from top N grid results.
    method: 'voting' | 'stacking' | 'cascading'
    """
    configs = _get_top_configs(top_n, sort_by)
    print(f"\n{'='*70}")
    print(f"  ENSEMBLE ({method}) — Top {top_n} by {sort_by}")
    print(f"{'='*70}")
    for i, cfg in enumerate(configs):
        print(f"  {i+1}. {cfg['model']} | {cfg['feature_set']} | {cfg['target']}")

    # Use the target from the best config for final evaluation
    best_target = configs[0]["target"]
    is_mc, desc = TARGET_META[best_target]

    # Load data once
    df_base = load_base_df()
    df = add_features(df_base)
    targets = compute_target_variants(df)
    df["_target"] = targets[best_target]

    # We need a common feature set — use the largest one present in configs
    all_fsets = set(cfg["feature_set"] for cfg in configs)
    # Use the union; each model will get its own features
    max_fset_name = max(all_fsets, key=lambda f: len(FEATURE_SETS.get(f, [])))
    all_feature_cols = FEATURE_SETS[max_fset_name]

    X, y = prepare_Xy(df, all_feature_cols, target_col="_target")
    X_train, X_test, y_train, y_test = temporal_split(X, y, train_frac=0.8, embargo_rows=30)

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)
    sw = compute_sample_weights(y_train)

    class_labels = tuple(sorted(np.unique(y)))
    n_classes = len(class_labels)

    # Train all base models
    trained_models = []
    for cfg in configs:
        mod = _load_model_module(cfg["model"])
        model = mod.make_model(is_multiclass=is_mc)
        # Each model trains on its specific feature set mapped to common columns
        fset_cols = FEATURE_SETS[cfg["feature_set"]]
        # Get column indices for this model's feature set
        col_indices = [all_feature_cols.index(c) for c in fset_cols if c in all_feature_cols]
        X_tr_m = X_train_s[:, col_indices]
        X_te_m = X_test_s[:, col_indices]

        val_split = int(len(X_tr_m) * 0.9)
        mod.train(
            model,
            X_tr_m[:val_split], y_train[:val_split],
            X_val=X_tr_m[val_split:], y_val=y_train[val_split:],
            sample_weight=sw[:val_split],
        )
        trained_models.append((cfg, model, col_indices))
        print(f"  Trained {cfg['model']} ({cfg['feature_set']})")

    if method == "voting":
        # Average probabilities
        probas = []
        for cfg, model, col_idx in trained_models:
            probas.append(model.predict_proba(X_test_s[:, col_idx]))
        avg_proba = np.mean(probas, axis=0)
        y_pred = class_labels[np.argmax(avg_proba, axis=1)] if isinstance(class_labels, np.ndarray) else np.array([class_labels[i] for i in np.argmax(avg_proba, axis=1)])

        result = evaluate_model(
            y_test, y_pred, avg_proba, class_labels,
            f"Voting({top_n})", max_fset_name, best_target, is_mc,
        )
        log_result(result)
        print_result(result)

    elif method == "stacking":
        # Collect OOF predictions from train, combine with meta-learner
        # For simplicity: use last 10% of train as stacking validation
        stack_split = int(len(X_train_s) * 0.8)

        # Get stacking features (probabilities from each model on stack_val)
        X_stack_train = []
        X_stack_test = []
        for cfg, model, col_idx in trained_models:
            p_train = model.predict_proba(X_train_s[stack_split:, col_idx])
            p_test = model.predict_proba(X_test_s[:, col_idx])
            X_stack_train.append(p_train)
            X_stack_test.append(p_test)

        X_meta_train = np.hstack(X_stack_train)
        X_meta_test = np.hstack(X_stack_test)
        y_meta_train = y_train[stack_split:]

        # Meta-learner
        meta = LogisticRegression(max_iter=1000, random_state=42, class_weight="balanced")
        meta.fit(X_meta_train, y_meta_train)
        y_pred = meta.predict(X_meta_test)
        y_proba = meta.predict_proba(X_meta_test)

        result = evaluate_model(
            y_test, y_pred, y_proba, class_labels,
            f"Stacking({top_n})", max_fset_name, best_target, is_mc,
        )
        log_result(result)
        print_result(result)

    elif method == "cascading":
        # Model 1 filters → Model 2 confirms
        # Only evaluate model 2 on samples where model 1 says bullish (P>0.5)
        cfg1, model1, idx1 = trained_models[0]
        cfg2, model2, idx2 = trained_models[1] if len(trained_models) > 1 else trained_models[0]

        proba1 = model1.predict_proba(X_test_s[:, idx1])
        idx_bull = list(class_labels).index(1) if 1 in class_labels else 0
        mask_pass = proba1[:, idx_bull] > 0.5

        if mask_pass.sum() == 0:
            print("  Cascading: Model 1 produced 0 bullish signals, skipping.")
            return

        X_filtered = X_test_s[mask_pass]
        y_filtered = y_test[mask_pass]

        proba2 = model2.predict_proba(X_filtered[:, idx2])
        y_pred2 = np.array([class_labels[i] for i in np.argmax(proba2, axis=1)])

        result = evaluate_model(
            y_filtered, y_pred2, proba2, class_labels,
            f"Cascade({cfg1['model']}→{cfg2['model']})", max_fset_name, best_target, is_mc,
        )
        result["n_passed_filter"] = int(mask_pass.sum())
        log_result(result)
        print_result(result)
        print(f"  Filter pass rate: {mask_pass.sum()}/{len(y_test)} ({100*mask_pass.mean():.1f}%)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--top", type=int, default=3, help="Number of top models to combine")
    parser.add_argument("--method", nargs="+", default=["voting", "stacking", "cascading"])
    parser.add_argument("--sort-by", default="prec@0.7", help="Metric to select top models")
    args = parser.parse_args()
    for m in args.method:
        build_ensemble(method=m, top_n=args.top, sort_by=args.sort_by)


if __name__ == "__main__":
    main()
