#!/usr/bin/env python3
"""
meta_labeling.py — Meta-Labeling framework (López de Prado).

Two-stage approach:
  1. Primary model: high recall, low precision (generates many signals)
  2. Meta-model: learns WHEN the primary's signals are actually profitable

Usage:
  cd stock-training/ml
  python -m experiments.meta_labeling
  python -m experiments.meta_labeling --walk-forward
"""

import argparse
import gc
import json
import os
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    roc_auc_score, classification_report, confusion_matrix,
)
from lightgbm import LGBMClassifier, early_stopping

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.data_loader import (
    load_df_with_features, temporal_split, prepare_Xy, walk_forward_splits,
)
from experiments.feature_engineer import FEATURE_SETS
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.run_grid import compute_sample_weights

# ── Config ────────────────────────────────────────────────────────────────────

# Primary model: high recall, catches most opportunities
PRIMARY_TARGET = "bin_rr10m_ge_2"
PRIMARY_FSET = "V3"
PRIMARY_THRESHOLD = 0.50  # threshold for primary signal generation

# Meta-model target: the actual trade target we care about
META_TRADE_TARGET = "bin_rr10m_ge_2"  # same target, but meta-model decides sizing

RESULTS_DIR = Path(__file__).resolve().parent / "results"
META_MODELS_DIR = RESULTS_DIR / "best_models" / "meta_labeling"


def precision_at_threshold(y_true, y_proba, threshold):
    mask = y_proba >= threshold
    n = int(mask.sum())
    if n == 0:
        return 0.0, 0
    prec = float((mask & (y_true == 1)).sum()) / n
    return prec, n


# ── Step 1: Generate primary model predictions ───────────────────────────────

def train_primary_model(X_train, y_train):
    """Train primary model with params that maximize RECALL."""
    n_pos = (y_train == 1).sum()
    n_neg = (y_train == 0).sum()
    scale_pos = n_neg / max(n_pos, 1)

    model = LGBMClassifier(
        n_estimators=300, max_depth=6, num_leaves=31,
        min_child_samples=20, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        reg_alpha=0.1, reg_lambda=1.0,
        scale_pos_weight=scale_pos,
        random_state=42, n_jobs=-1, verbose=-1,
    )

    sw = compute_sample_weights(y_train)
    val_split = int(len(X_train) * 0.9)
    model.fit(
        X_train[:val_split], y_train[:val_split],
        sample_weight=sw[:val_split],
        eval_set=[(X_train[val_split:], y_train[val_split:])],
        callbacks=[early_stopping(30, verbose=False)],
    )
    return model


# ── Step 2: Create meta-labels ───────────────────────────────────────────────

def create_meta_labels(primary_proba, y_true, threshold):
    """
    For each signal where primary says YES (prob >= threshold):
    - meta_label = 1 if the trade was actually profitable (y_true == 1)
    - meta_label = 0 if the trade was unprofitable (y_true == 0)

    Returns mask of primary signals and meta-labels.
    """
    signal_mask = primary_proba >= threshold
    meta_labels = y_true[signal_mask].copy()
    return signal_mask, meta_labels


# ── Step 3: Train meta-model ─────────────────────────────────────────────────

def build_meta_features(X, primary_proba, feature_cols):
    """
    Build meta-model features:
    - All original features
    - Primary model probability (key signal)
    - Distance from threshold (confidence)
    """
    meta_X = X.copy() if isinstance(X, pd.DataFrame) else pd.DataFrame(X, columns=feature_cols)
    meta_X["primary_prob"] = primary_proba
    meta_X["primary_confidence"] = np.abs(primary_proba - 0.5) * 2  # 0=uncertain, 1=confident
    return meta_X


def train_meta_model(meta_X_train, meta_y_train):
    """Train meta-model: predicts if primary's signal will be profitable."""
    n_pos = (meta_y_train == 1).sum()
    n_neg = (meta_y_train == 0).sum()
    scale_pos = n_neg / max(n_pos, 1)

    model = LGBMClassifier(
        n_estimators=500, max_depth=4, num_leaves=15,
        min_child_samples=50, learning_rate=0.03,
        subsample=0.7, colsample_bytree=0.7,
        reg_alpha=0.5, reg_lambda=2.0,
        scale_pos_weight=scale_pos,
        random_state=42, n_jobs=-1, verbose=-1,
    )

    sw = compute_sample_weights(meta_y_train)
    val_split = int(len(meta_X_train) * 0.9)
    model.fit(
        meta_X_train[:val_split], meta_y_train[:val_split],
        sample_weight=sw[:val_split],
        eval_set=[(meta_X_train[val_split:], meta_y_train[val_split:])],
        callbacks=[early_stopping(50, verbose=False)],
    )
    return model


# ── Full pipeline ─────────────────────────────────────────────────────────────

def run_meta_labeling(df, targets, fset_name=PRIMARY_FSET, primary_target=PRIMARY_TARGET):
    print(f"\n{'=' * 70}")
    print(f"  META-LABELING PIPELINE")
    print(f"  Primary: {primary_target} | FSet: {fset_name}")
    print(f"  Primary threshold: {PRIMARY_THRESHOLD} (high recall)")
    print(f"{'=' * 70}")

    # Prepare data
    target_bundle = targets[primary_target]
    y_full = np.asarray(target_bundle["y"])
    valid_mask = np.asarray(target_bundle["valid"]).astype(bool)

    df_target = df.loc[valid_mask].copy()
    df_target["_target"] = y_full[valid_mask]

    feature_cols = FEATURE_SETS[fset_name]
    X, y = prepare_Xy(df_target, feature_cols, "_target")

    # Temporal split
    X_train, X_test, y_train, y_test = temporal_split(X, y, train_frac=0.8, embargo_rows=30)

    print(f"\n  Data: {len(X_train)} train, {len(X_test)} test")
    print(f"  Target balance: {(y_train == 1).mean():.1%} positive")

    # ── Step 1: Train primary model ──
    print(f"\n  [Step 1] Training primary model (high recall)...")
    t0 = time.time()
    X_train_arr = X_train.values
    X_test_arr = X_test.values

    primary_model = train_primary_model(X_train_arr, y_train)
    primary_train_proba = primary_model.predict_proba(X_train_arr)[:, 1]
    primary_test_proba = primary_model.predict_proba(X_test_arr)[:, 1]

    # Primary probability distribution
    print(f"    Primary prob distribution (test):")
    for pct in [10, 25, 50, 75, 90]:
        print(f"      p{pct}: {np.percentile(primary_test_proba, pct):.3f}")
    print(f"      mean: {primary_test_proba.mean():.3f}, std: {primary_test_proba.std():.3f}")

    # Primary model stats
    primary_signals_train = (primary_train_proba >= PRIMARY_THRESHOLD).sum()
    primary_signals_test = (primary_test_proba >= PRIMARY_THRESHOLD).sum()
    primary_recall = recall_score(y_test, (primary_test_proba >= PRIMARY_THRESHOLD).astype(int))
    primary_precision = precision_score(y_test, (primary_test_proba >= PRIMARY_THRESHOLD).astype(int), zero_division=0)

    print(f"    Trained in {time.time() - t0:.1f}s")
    print(f"    Train signals: {primary_signals_train} ({primary_signals_train/len(y_train)*100:.1f}%)")
    print(f"    Test signals:  {primary_signals_test} ({primary_signals_test/len(y_test)*100:.1f}%)")
    print(f"    Test recall:   {primary_recall:.3f}")
    print(f"    Test precision:{primary_precision:.3f}")

    # ── Step 2: Create meta-labels ──
    print(f"\n  [Step 2] Creating meta-labels...")
    train_signal_mask, meta_y_train = create_meta_labels(primary_train_proba, y_train, PRIMARY_THRESHOLD)
    test_signal_mask, meta_y_test = create_meta_labels(primary_test_proba, y_test, PRIMARY_THRESHOLD)

    print(f"    Train meta-samples: {len(meta_y_train)} ({(meta_y_train == 1).mean():.1%} positive)")
    print(f"    Test meta-samples:  {len(meta_y_test)} ({(meta_y_test == 1).mean():.1%} positive)")

    # ── Step 3: Build meta-features + train meta-model ──
    print(f"\n  [Step 3] Training meta-model...")
    t0 = time.time()

    meta_X_train = build_meta_features(
        X_train_arr[train_signal_mask], primary_train_proba[train_signal_mask], feature_cols
    )
    meta_X_test = build_meta_features(
        X_test_arr[test_signal_mask], primary_test_proba[test_signal_mask], feature_cols
    )

    meta_model = train_meta_model(meta_X_train.values, meta_y_train)
    meta_test_proba = meta_model.predict_proba(meta_X_test.values)[:, 1]
    meta_test_pred = (meta_test_proba >= 0.5).astype(int)

    print(f"    Trained in {time.time() - t0:.1f}s")

    # ── Results ──
    print(f"\n{'─' * 60}")
    print(f"  RESULTS — Meta-Labeling")
    print(f"{'─' * 60}")

    # Baseline: primary model alone at various thresholds
    print(f"\n  PRIMARY MODEL ALONE:")
    for thr in [0.40, 0.50, 0.55, 0.60, 0.65, 0.70]:
        p, n = precision_at_threshold(y_test, primary_test_proba, thr)
        print(f"    P(primary >= {thr:.2f}): precision={p:.3f} ({n} signals)")

    # Meta-model results
    print(f"\n  META-MODEL (on primary signals only):")
    print(f"    Accuracy:  {accuracy_score(meta_y_test, meta_test_pred):.3f}")
    print(f"    Precision: {precision_score(meta_y_test, meta_test_pred, zero_division=0):.3f}")
    print(f"    Recall:    {recall_score(meta_y_test, meta_test_pred, zero_division=0):.3f}")
    print(f"    F1:        {f1_score(meta_y_test, meta_test_pred, zero_division=0):.3f}")
    try:
        print(f"    AUC:       {roc_auc_score(meta_y_test, meta_test_proba):.3f}")
    except ValueError:
        print(f"    AUC:       N/A")

    # Meta-model at thresholds
    print(f"\n  META-MODEL precision @ threshold:")
    for thr in [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]:
        p, n = precision_at_threshold(meta_y_test, meta_test_proba, thr)
        print(f"    P(meta >= {thr:.2f}): precision={p:.3f} ({n} signals)")

    # Combined: primary threshold + meta threshold
    print(f"\n  COMBINED (primary >= {PRIMARY_THRESHOLD} AND meta >= threshold):")
    for meta_thr in [0.50, 0.55, 0.60, 0.65, 0.70]:
        combined_mask = meta_test_proba >= meta_thr
        n_combined = combined_mask.sum()
        if n_combined > 0:
            combined_precision = (meta_y_test[combined_mask] == 1).mean()
            print(f"    meta >= {meta_thr:.2f}: precision={combined_precision:.3f} ({n_combined} signals)")
        else:
            print(f"    meta >= {meta_thr:.2f}: no signals")

    # Feature importance of meta-model
    print(f"\n  META-MODEL Feature Importance (top 10):")
    meta_feature_names = list(feature_cols) + ["primary_prob", "primary_confidence"]
    importances = meta_model.feature_importances_
    feat_imp = sorted(zip(meta_feature_names, importances), key=lambda x: x[1], reverse=True)
    for feat, imp in feat_imp[:10]:
        bar = "█" * int(imp / max(importances) * 30)
        print(f"    {feat:30s} {imp:5d} {bar}")

    # Confusion matrix
    print(f"\n  Confusion Matrix (meta-model):")
    cm = confusion_matrix(meta_y_test, meta_test_pred)
    if cm.shape == (2, 2):
        print(f"    TN={cm[0,0]:>7d}  FP={cm[0,1]:>7d}")
        print(f"    FN={cm[1,0]:>7d}  TP={cm[1,1]:>7d}")

    return primary_model, meta_model, feature_cols


# ── Walk-forward meta-labeling ────────────────────────────────────────────────

def run_walk_forward_meta(df, targets, fset_name=PRIMARY_FSET, primary_target=PRIMARY_TARGET,
                          train_weeks=8, test_weeks=1):
    print(f"\n{'=' * 70}")
    print(f"  WALK-FORWARD META-LABELING")
    print(f"  Primary: {primary_target} | FSet: {fset_name}")
    print(f"  Train: {train_weeks}w | Test: {test_weeks}w")
    print(f"{'=' * 70}")

    target_bundle = targets[primary_target]
    y_full = np.asarray(target_bundle["y"])
    valid_mask = np.asarray(target_bundle["valid"]).astype(bool)

    df_target = df.loc[valid_mask].copy()
    df_target["_target"] = y_full[valid_mask]

    feature_cols = FEATURE_SETS[fset_name]

    splits = walk_forward_splits(df_target, train_weeks, test_weeks)
    print(f"  {len(splits)} splits\n")

    results = []

    for i, (train_df, test_df) in enumerate(splits):
        X_train, y_train = prepare_Xy(train_df, feature_cols, "_target")
        X_test, y_test = prepare_Xy(test_df, feature_cols, "_target")

        if len(X_train) < 500 or len(X_test) < 50:
            continue
        if len(np.unique(y_train)) < 2:
            continue

        X_train_arr = X_train.values
        X_test_arr = X_test.values

        # Step 1: Primary model
        primary_model = train_primary_model(X_train_arr, y_train)
        primary_train_proba = primary_model.predict_proba(X_train_arr)[:, 1]
        primary_test_proba = primary_model.predict_proba(X_test_arr)[:, 1]

        # Step 2: Meta-labels
        train_signal_mask, meta_y_train = create_meta_labels(primary_train_proba, y_train, PRIMARY_THRESHOLD)
        test_signal_mask, meta_y_test = create_meta_labels(primary_test_proba, y_test, PRIMARY_THRESHOLD)

        if len(meta_y_train) < 100 or len(meta_y_test) < 20:
            continue
        if len(np.unique(meta_y_train)) < 2:
            continue

        # Step 3: Meta-model
        meta_X_train = build_meta_features(
            X_train_arr[train_signal_mask], primary_train_proba[train_signal_mask], feature_cols
        )
        meta_X_test = build_meta_features(
            X_test_arr[test_signal_mask], primary_test_proba[test_signal_mask], feature_cols
        )

        meta_model = train_meta_model(meta_X_train.values, meta_y_train)
        meta_test_proba = meta_model.predict_proba(meta_X_test.values)[:, 1]

        # Metrics
        try:
            meta_auc = roc_auc_score(meta_y_test, meta_test_proba)
        except ValueError:
            meta_auc = 0.5

        # Primary alone P@0.70
        p70_primary, n70_primary = precision_at_threshold(y_test, primary_test_proba, 0.70)

        # Meta P@0.60
        p60_meta, n60_meta = precision_at_threshold(meta_y_test, meta_test_proba, 0.60)
        p70_meta, n70_meta = precision_at_threshold(meta_y_test, meta_test_proba, 0.70)

        result = {
            "split": i,
            "meta_auc": meta_auc,
            "p70_primary": p70_primary, "n70_primary": n70_primary,
            "p60_meta": p60_meta, "n60_meta": n60_meta,
            "p70_meta": p70_meta, "n70_meta": n70_meta,
            "meta_pos_rate": (meta_y_test == 1).mean(),
            "n_meta_test": len(meta_y_test),
        }
        results.append(result)

        if (i + 1) % 5 == 0 or i == len(splits) - 1:
            print(f"  Split {i+1}/{len(splits)}: meta_AUC={meta_auc:.3f} "
                  f"P@.70_primary={p70_primary:.3f}({n70_primary}) "
                  f"P@.70_meta={p70_meta:.3f}({n70_meta})")

    if not results:
        print("  No valid results")
        return None

    results_df = pd.DataFrame(results)

    print(f"\n{'─' * 60}")
    print(f"  WALK-FORWARD SUMMARY — Meta-Labeling")
    print(f"{'─' * 60}")
    print(f"  Splits:          {len(results_df)}")
    print(f"  Meta AUC:        {results_df['meta_auc'].mean():.3f} (±{results_df['meta_auc'].std():.3f})")
    print(f"  P@0.70 primary:  {results_df['p70_primary'].mean():.3f} (±{results_df['p70_primary'].std():.3f}) avg {results_df['n70_primary'].mean():.0f} sig")
    print(f"  P@0.60 meta:     {results_df['p60_meta'].mean():.3f} (±{results_df['p60_meta'].std():.3f}) avg {results_df['n60_meta'].mean():.0f} sig")
    print(f"  P@0.70 meta:     {results_df['p70_meta'].mean():.3f} (±{results_df['p70_meta'].std():.3f}) avg {results_df['n70_meta'].mean():.0f} sig")
    print(f"  Meta pos rate:   {results_df['meta_pos_rate'].mean():.3f}")

    return results_df


# ── Save models ───────────────────────────────────────────────────────────────

def save_meta_models(primary_model, meta_model, feature_cols):
    META_MODELS_DIR.mkdir(parents=True, exist_ok=True)

    joblib.dump(primary_model, META_MODELS_DIR / "primary_model.joblib")
    joblib.dump(meta_model, META_MODELS_DIR / "meta_model.joblib")

    meta = {
        "primary_target": PRIMARY_TARGET,
        "primary_fset": PRIMARY_FSET,
        "primary_threshold": PRIMARY_THRESHOLD,
        "meta_trade_target": META_TRADE_TARGET,
        "feature_columns": list(feature_cols),
        "meta_features": list(feature_cols) + ["primary_prob", "primary_confidence"],
    }

    with open(META_MODELS_DIR / "meta.json", "w") as f:
        json.dump(meta, f, indent=2, default=str)

    print(f"\n  Models saved to {META_MODELS_DIR}/")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--walk-forward", action="store_true")
    parser.add_argument("--fset", default=PRIMARY_FSET)
    parser.add_argument("--target", default=PRIMARY_TARGET)
    args = parser.parse_args()

    os.environ.setdefault("TRAINING_MAX_ROWS", "2000000")

    print("Loading data...")
    t0 = time.time()
    df = load_df_with_features(filter_valid=True)
    targets = compute_target_variants(df)
    gc.collect()
    print(f"  {len(df)} rows, {len(targets)} targets in {time.time()-t0:.1f}s")

    if args.walk_forward:
        run_walk_forward_meta(df, targets, args.fset, args.target)
    else:
        primary_model, meta_model, feature_cols = run_meta_labeling(
            df, targets, args.fset, args.target
        )
        save_meta_models(primary_model, meta_model, feature_cols)


if __name__ == "__main__":
    main()
