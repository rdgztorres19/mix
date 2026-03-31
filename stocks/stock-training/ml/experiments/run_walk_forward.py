#!/usr/bin/env python3
"""
run_walk_forward.py — Walk-forward validation for predict model.
Trains on N weeks, tests on next week, advances 1 week, repeats.
Much more realistic than a single 80/20 temporal split.

Usage:
  cd stock-training/ml
  python -m experiments.run_walk_forward
  python -m experiments.run_walk_forward --target bin_rr10m_ge_2 --fset V2_full
  python -m experiments.run_walk_forward --bearish
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import precision_score, recall_score, f1_score, roc_auc_score
from lightgbm import LGBMClassifier

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.data_loader import load_df_with_features, walk_forward_splits, prepare_Xy
from experiments.feature_engineer import FEATURE_SETS
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.run_grid import compute_sample_weights


def precision_at_threshold(y_true, y_proba, threshold):
    mask = y_proba >= threshold
    n = mask.sum()
    if n == 0:
        return 0.0, 0
    prec = (mask & (y_true == 1)).sum() / n
    return float(prec), int(n)


def run_walk_forward(
    df: pd.DataFrame,
    targets: dict,
    target_name: str,
    fset_name: str,
    train_weeks: int = 8,
    test_weeks: int = 1,
):
    print(f"\n{'=' * 70}")
    print(f"  WALK-FORWARD: {target_name} | {fset_name}")
    print(f"  Train: {train_weeks}w | Test: {test_weeks}w")
    print(f"{'=' * 70}")

    is_mc = TARGET_META[target_name][0]
    bundle = targets[target_name]
    y_full = np.asarray(bundle["y"])
    valid_mask = np.asarray(bundle["valid"]).astype(bool)

    df_target = df.loc[valid_mask].copy()
    df_target["_target"] = y_full[valid_mask]

    if df_target["_target"].nunique() < 2:
        print("  SKIP: less than 2 classes")
        return None

    feature_cols = FEATURE_SETS[fset_name]
    use_scaler = not fset_name.startswith("V2")

    splits = walk_forward_splits(df_target, train_weeks, test_weeks)
    print(f"  {len(splits)} splits\n")

    if not splits:
        print("  No valid splits")
        return None

    all_results = []

    for i, (train_df, test_df) in enumerate(splits):
        X_train, y_train = prepare_Xy(train_df, feature_cols, "_target")
        X_test, y_test = prepare_Xy(test_df, feature_cols, "_target")

        if len(X_train) < 100 or len(X_test) < 20:
            continue
        if len(np.unique(y_train)) < 2:
            continue

        if use_scaler:
            scaler = StandardScaler()
            X_train_s = scaler.fit_transform(X_train)
            X_test_s = scaler.transform(X_test)
        else:
            X_train_s = X_train.values
            X_test_s = X_test.values

        n_pos = (y_train == 1).sum()
        n_neg = (y_train == 0).sum()
        scale_pos = n_neg / max(n_pos, 1)

        model = LGBMClassifier(
            n_estimators=300, max_depth=6, num_leaves=31,
            min_child_samples=20, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8,
            reg_alpha=0.1, reg_lambda=1.0,
            scale_pos_weight=scale_pos if not is_mc else 1.0,
            random_state=42, n_jobs=-1, verbose=-1,
        )

        sw = compute_sample_weights(y_train)
        val_split = int(len(X_train_s) * 0.9)
        try:
            model.fit(
                X_train_s[:val_split], y_train[:val_split],
                sample_weight=sw[:val_split],
                eval_set=[(X_train_s[val_split:], y_train[val_split:])],
                callbacks=[__import__("lightgbm").early_stopping(30, verbose=False)],
            )
        except Exception:
            model.fit(X_train_s, y_train, sample_weight=sw)

        y_pred = model.predict(X_test_s)
        y_proba = model.predict_proba(X_test_s)
        proba_pos = y_proba[:, 1] if y_proba.shape[1] > 1 else y_proba[:, 0]

        prec = precision_score(y_test, y_pred, zero_division=0)
        rec = recall_score(y_test, y_pred, zero_division=0)
        f1 = f1_score(y_test, y_pred, zero_division=0)
        try:
            auc = roc_auc_score(y_test, proba_pos)
        except ValueError:
            auc = 0.5

        p60, n60 = precision_at_threshold(y_test, proba_pos, 0.60)
        p70, n70 = precision_at_threshold(y_test, proba_pos, 0.70)

        train_dates = sorted(train_df["date"].unique())
        test_dates = sorted(test_df["date"].unique())

        result = {
            "split": i,
            "train_start": str(train_dates[0]),
            "train_end": str(train_dates[-1]),
            "test_start": str(test_dates[0]),
            "test_end": str(test_dates[-1]),
            "n_train": len(X_train),
            "n_test": len(X_test),
            "precision": prec,
            "recall": rec,
            "f1": f1,
            "auc": auc,
            "p60": p60, "n60": n60,
            "p70": p70, "n70": n70,
            "pos_rate_train": (y_train == 1).mean(),
            "pos_rate_test": (y_test == 1).mean(),
        }
        all_results.append(result)

        if (i + 1) % 5 == 0 or i == len(splits) - 1:
            print(f"  Split {i+1}/{len(splits)}: AUC={auc:.3f} P@.70={p70:.3f}({n70}) F1={f1:.3f}")

    if not all_results:
        print("  No valid results")
        return None

    results_df = pd.DataFrame(all_results)

    # Summary
    print(f"\n{'─' * 60}")
    print(f"  WALK-FORWARD SUMMARY — {target_name} | {fset_name}")
    print(f"{'─' * 60}")
    print(f"  Splits:     {len(results_df)}")
    print(f"  AUC:        {results_df['auc'].mean():.3f} (±{results_df['auc'].std():.3f})")
    print(f"  Precision:  {results_df['precision'].mean():.3f} (±{results_df['precision'].std():.3f})")
    print(f"  Recall:     {results_df['recall'].mean():.3f} (±{results_df['recall'].std():.3f})")
    print(f"  F1:         {results_df['f1'].mean():.3f} (±{results_df['f1'].std():.3f})")
    print(f"  P@0.60:     {results_df['p60'].mean():.3f} (±{results_df['p60'].std():.3f}) avg {results_df['n60'].mean():.0f} signals")
    print(f"  P@0.70:     {results_df['p70'].mean():.3f} (±{results_df['p70'].std():.3f}) avg {results_df['n70'].mean():.0f} signals")
    print(f"  Pos rate:   train={results_df['pos_rate_train'].mean():.3f} test={results_df['pos_rate_test'].mean():.3f}")

    # Stability: how consistent is performance across splits?
    auc_stable = results_df["auc"].std() < 0.05
    p70_stable = results_df["p70"].std() < 0.10
    print(f"\n  Stability:  AUC {'STABLE' if auc_stable else 'UNSTABLE'} | P@0.70 {'STABLE' if p70_stable else 'UNSTABLE'}")

    return results_df


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default=None, help="Target name")
    parser.add_argument("--fset", default=None, help="Feature set name")
    parser.add_argument("--bearish", action="store_true", help="Run bearish targets")
    parser.add_argument("--train-weeks", type=int, default=8)
    parser.add_argument("--test-weeks", type=int, default=1)
    args = parser.parse_args()

    print("Loading data...")
    t0 = time.time()
    df = load_df_with_features()
    targets = compute_target_variants(df)
    print(f"  {len(df)} rows, {len(targets)} targets in {time.time()-t0:.1f}s\n")

    if args.bearish:
        combos = [
            ("bin_drop_2p0_10m", "V2_full_bear"),
            ("bin_drop_4p0_10m", "V2_full_bear"),
            ("bin_sl_before_tp_10m", "V2_full_bear"),
            ("bin_rr10m_bearish_ge_2", "V2_full_bear"),
            ("bin_fr10m_neg_1p0", "V2_full_bear"),
            ("bin_clean_short_10m", "bearish"),
            ("bin_breakdown_lod_10m", "bearish"),
        ]
    elif args.target and args.fset:
        combos = [(args.target, args.fset)]
    else:
        # Default: run the best existing bullish targets + new bearish
        combos = [
            # Bullish (existing best)
            ("bin_rr10m_ge_2", "V2_full"),
            ("bin_rr10m_ge_2", "D_clean_ext"),
            ("bin_tb30m_tp4p0_sl2p0", "V2_full"),
            # Bearish (new)
            ("bin_drop_2p0_10m", "V2_full_bear"),
            ("bin_rr10m_bearish_ge_2", "V2_full_bear"),
            ("bin_sl_before_tp_10m", "V2_full_bear"),
        ]

    all_summaries = []
    for target_name, fset_name in combos:
        if target_name not in targets:
            print(f"  SKIP: target '{target_name}' not found")
            continue
        if fset_name not in FEATURE_SETS:
            print(f"  SKIP: feature set '{fset_name}' not found")
            continue

        result = run_walk_forward(
            df, targets, target_name, fset_name,
            args.train_weeks, args.test_weeks,
        )
        if result is not None:
            all_summaries.append({
                "target": target_name,
                "fset": fset_name,
                "auc_mean": result["auc"].mean(),
                "auc_std": result["auc"].std(),
                "p70_mean": result["p70"].mean(),
                "p70_std": result["p70"].std(),
                "f1_mean": result["f1"].mean(),
                "n_splits": len(result),
            })

    if all_summaries:
        print(f"\n\n{'=' * 90}")
        print(f"  WALK-FORWARD COMPARISON")
        print(f"{'=' * 90}")
        print(f"  {'Target':<30s} {'FSet':<15s} {'AUC':>8s} {'P@.70':>8s} {'F1':>8s} {'Splits':>6s}")
        print(f"  {'─'*30} {'─'*15} {'─'*8} {'─'*8} {'─'*8} {'─'*6}")
        for s in sorted(all_summaries, key=lambda x: x["auc_mean"], reverse=True):
            print(f"  {s['target']:<30s} {s['fset']:<15s} "
                  f"{s['auc_mean']:.3f}±{s['auc_std']:.2f} "
                  f"{s['p70_mean']:.3f}±{s['p70_std']:.2f} "
                  f"{s['f1_mean']:.3f} "
                  f"{s['n_splits']:>5d}")


if __name__ == "__main__":
    main()
