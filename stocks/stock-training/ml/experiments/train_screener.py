#!/usr/bin/env python3
"""
train_screener.py — Train the screener ML model.

Predicts which stocks from the wide screener (top 100) will produce
profitable trades. Uses cross-sectional labeling: top 30% by total_pnl = 1,
bottom 30% = 0, middle 40% dropped.

Usage:
  cd stock-training/ml
  python -m experiments.train_screener
  python -m experiments.train_screener --analyze   # just analyze data, don't train
"""

import argparse
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
)
from lightgbm import LGBMClassifier

# ── Paths ─────────────────────────────────────────────────────────────────────

DATA_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "screener-training.csv"
RESULTS_DIR = Path(__file__).resolve().parent / "results"
MODELS_DIR = RESULTS_DIR / "best_models" / "screener_lgbm"
RESULTS_DIR.mkdir(exist_ok=True)

# ── Features & Config ─────────────────────────────────────────────────────────

FEATURES = [
    "price", "gap_pct", "premarket_volume", "shares_outstanding", "market_cap",
    "atr_pct", "volume_at_entry", "dist_hod_pct", "time_of_first_entry_min",
    "in_gapper", "in_gainer_session", "in_gainer_intraday", "in_high_session", "in_high_current",
    "rank_gapper", "rank_gainer_session", "rank_gainer_intraday", "rank_high_session", "rank_high_current",
    "num_ranking_types", "max_metric_value", "combined_rank",
]

TOP_PCT = 0.30      # top 30% = good stock (label 1)
BOTTOM_PCT = 0.30   # bottom 30% = bad stock (label 0)
TRAIN_FRAC = 0.80   # temporal split
EMBARGO_DAYS = 5    # gap between train and test


# ── Data Loading ──────────────────────────────────────────────────────────────

def load_data() -> pd.DataFrame:
    print(f"Loading {DATA_PATH}...")
    df = pd.read_csv(DATA_PATH)
    print(f"  {len(df)} rows, {df.date.nunique()} dates, {df.symbol.nunique()} symbols")
    return df


def build_cross_sectional_target(df: pd.DataFrame) -> pd.DataFrame:
    """
    Cross-sectional labeling: per day, rank stocks by total_pnl.
    Top 30% = 1 (good), Bottom 30% = 0 (bad), Middle = NaN (dropped).
    Only considers stocks with at least 1 signal.
    """
    # Stocks without signals get total_pnl = 0, which biases the middle.
    # We keep them as potential "bad" stocks since the model didn't find entries.
    df = df.copy()

    # Cross-sectional ranking per day
    df["rank_pct"] = df.groupby("date")["total_pnl"].rank(pct=True, method="average")

    # Label: top = 1, bottom = 0, middle = NaN
    df["target"] = np.where(
        df["rank_pct"] >= (1 - TOP_PCT), 1,
        np.where(df["rank_pct"] <= BOTTOM_PCT, 0, np.nan)
    )

    n_before = len(df)
    df = df.dropna(subset=["target"])
    df["target"] = df["target"].astype(int)

    print(f"  Cross-sectional labeling: {n_before} → {len(df)} rows (dropped {n_before - len(df)} middle)")
    print(f"  Target=1 (good): {(df.target == 1).sum()} ({(df.target == 1).mean()*100:.1f}%)")
    print(f"  Target=0 (bad):  {(df.target == 0).sum()} ({(df.target == 0).mean()*100:.1f}%)")

    return df


def temporal_split(df: pd.DataFrame):
    """Split by date: first 80% dates = train, last 20% = test, with embargo."""
    dates = sorted(df.date.unique())
    n_train = int(len(dates) * TRAIN_FRAC)

    train_dates = set(dates[:n_train])
    # Embargo: skip EMBARGO_DAYS after last train date
    test_dates = set(dates[n_train + EMBARGO_DAYS:])

    train = df[df.date.isin(train_dates)].copy()
    test = df[df.date.isin(test_dates)].copy()

    print(f"  Train: {len(train)} rows ({len(train_dates)} days: {min(train_dates)} → {max(train_dates)})")
    print(f"  Test:  {len(test)} rows ({len(test_dates)} days: {min(test_dates)} → {max(test_dates)})")
    print(f"  Embargo: {EMBARGO_DAYS} days")

    return train, test


# ── Analysis ──────────────────────────────────────────────────────────────────

def analyze_data(df: pd.DataFrame):
    """Print data exploration stats."""
    print("\n" + "=" * 70)
    print("  DATA ANALYSIS")
    print("=" * 70)

    print(f"\n--- Basic Stats ---")
    print(f"  Rows: {len(df)}")
    print(f"  Dates: {df.date.nunique()}")
    print(f"  Symbols: {df.symbol.nunique()}")
    print(f"  Avg rows/day: {len(df) / df.date.nunique():.0f}")

    print(f"\n--- Signal Distribution ---")
    has_sig = df[df.total_signals > 0]
    no_sig = df[df.total_signals == 0]
    print(f"  With signals: {len(has_sig)} ({len(has_sig)/len(df)*100:.1f}%)")
    print(f"  Without signals: {len(no_sig)} ({len(no_sig)/len(df)*100:.1f}%)")

    print(f"\n--- PnL Distribution (stocks with signals) ---")
    print(f"  Mean:   {has_sig.total_pnl.mean():.2f}%")
    print(f"  Median: {has_sig.total_pnl.median():.2f}%")
    print(f"  Std:    {has_sig.total_pnl.std():.2f}%")
    print(f"  Min:    {has_sig.total_pnl.min():.2f}%")
    print(f"  Max:    {has_sig.total_pnl.max():.2f}%")

    print(f"\n--- Win Rate Distribution (stocks with signals) ---")
    print(f"  Mean WR:   {has_sig.win_rate.mean()*100:.1f}%")
    print(f"  Median WR: {has_sig.win_rate.median()*100:.1f}%")

    print(f"\n--- Feature Correlations with total_pnl (stocks with signals) ---")
    for feat in FEATURES:
        if feat in has_sig.columns:
            corr = has_sig[feat].corr(has_sig["total_pnl"])
            if abs(corr) > 0.05:
                print(f"  {feat:30s} r={corr:+.3f}")

    # Cross-sectional target distribution
    df_labeled = build_cross_sectional_target(df)

    print(f"\n--- Feature Means by Target ---")
    for feat in FEATURES:
        if feat in df_labeled.columns:
            m1 = df_labeled[df_labeled.target == 1][feat].mean()
            m0 = df_labeled[df_labeled.target == 0][feat].mean()
            diff_pct = ((m1 - m0) / (abs(m0) + 1e-9)) * 100
            if abs(diff_pct) > 10:
                print(f"  {feat:30s}  good={m1:>12.2f}  bad={m0:>12.2f}  diff={diff_pct:+.0f}%")


# ── Training ──────────────────────────────────────────────────────────────────

def train_screener(df: pd.DataFrame):
    print("\n" + "=" * 70)
    print("  TRAINING SCREENER MODEL")
    print("=" * 70)

    # Build target
    df_labeled = build_target_has_winning(df)

    # Temporal split
    train_df, test_df = temporal_split(df_labeled)

    # Prepare X, y
    X_train = train_df[FEATURES].values
    y_train = train_df["target"].values
    X_test = test_df[FEATURES].values
    y_test = test_df["target"].values

    # Handle NaN/inf in features
    X_train = np.nan_to_num(X_train, nan=0, posinf=0, neginf=0)
    X_test = np.nan_to_num(X_test, nan=0, posinf=0, neginf=0)

    # Scale
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    # Class balance
    n_pos = (y_train == 1).sum()
    n_neg = (y_train == 0).sum()
    scale_pos = n_neg / n_pos if n_pos > 0 else 1.0
    print(f"  Class balance: {n_neg} neg / {n_pos} pos (scale_pos_weight={scale_pos:.2f})")

    # LightGBM with regularization (small dataset)
    model = LGBMClassifier(
        n_estimators=300,
        max_depth=5,
        num_leaves=31,
        min_child_samples=30,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_alpha=0.1,
        reg_lambda=1.0,
        scale_pos_weight=scale_pos,
        random_state=42,
        n_jobs=-1,
        verbose=-1,
    )

    print("\n  Training LightGBM...")
    t0 = time.time()

    # Early stopping with validation split
    val_split = int(len(X_train_s) * 0.9)
    model.fit(
        X_train_s[:val_split],
        y_train[:val_split],
        eval_set=[(X_train_s[val_split:], y_train[val_split:])],
        callbacks=[
            __import__("lightgbm").early_stopping(50, verbose=False),
        ],
    )

    elapsed = time.time() - t0
    print(f"  Trained in {elapsed:.1f}s (best iteration: {model.best_iteration_})")

    # Predict
    y_pred = model.predict(X_test_s)
    y_proba = model.predict_proba(X_test_s)[:, 1]

    # ── Metrics ──
    print(f"\n{'─' * 50}")
    print("  TEST SET RESULTS")
    print(f"{'─' * 50}")
    print(f"  Accuracy:  {accuracy_score(y_test, y_pred):.3f}")
    print(f"  Precision: {precision_score(y_test, y_pred):.3f}")
    print(f"  Recall:    {recall_score(y_test, y_pred):.3f}")
    print(f"  F1:        {f1_score(y_test, y_pred):.3f}")
    print(f"  AUC:       {roc_auc_score(y_test, y_proba):.3f}")

    # Precision at thresholds
    print(f"\n  Precision @ threshold:")
    for thr in [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]:
        mask = y_proba >= thr
        n_sig = mask.sum()
        if n_sig > 0:
            prec = (mask & (y_test == 1)).sum() / n_sig
            print(f"    P(good) >= {thr:.2f}: precision={prec:.3f} ({n_sig} signals)")
        else:
            print(f"    P(good) >= {thr:.2f}: no signals")

    # Confusion matrix
    print(f"\n  Confusion Matrix:")
    cm = confusion_matrix(y_test, y_pred)
    print(f"    TN={cm[0,0]:5d}  FP={cm[0,1]:5d}")
    print(f"    FN={cm[1,0]:5d}  TP={cm[1,1]:5d}")

    # Classification report
    print(f"\n{classification_report(y_test, y_pred, target_names=['bad (0)', 'good (1)'])}")

    # Feature importance
    print(f"\n  Feature Importance (top 15):")
    importances = model.feature_importances_
    feat_imp = sorted(zip(FEATURES, importances), key=lambda x: x[1], reverse=True)
    for feat, imp in feat_imp[:15]:
        bar = "█" * int(imp / max(importances) * 30)
        print(f"    {feat:30s} {imp:5d} {bar}")

    # ── Practical Evaluation: does it improve stock selection? ──
    print(f"\n{'─' * 50}")
    print("  PRACTICAL EVALUATION")
    print(f"{'─' * 50}")

    test_with_proba = test_df.copy()
    test_with_proba["screener_prob"] = y_proba

    for n_select in [20, 30, 40]:
        # Per day, select top N by screener probability
        selected = test_with_proba.groupby("date").apply(
            lambda g: g.nlargest(min(n_select, len(g)), "screener_prob"),
            include_groups=False,
        ).reset_index(drop=True)

        # Baseline: random selection (same N per day)
        baseline = test_with_proba.groupby("date").apply(
            lambda g: g.sample(min(n_select, len(g)), random_state=42),
            include_groups=False,
        ).reset_index(drop=True)

        sel_pnl = selected["total_pnl"].mean()
        sel_wr = selected[selected.total_signals > 0]["win_rate"].mean() * 100
        base_pnl = baseline["total_pnl"].mean()
        base_wr = baseline[baseline.total_signals > 0]["win_rate"].mean() * 100

        print(f"\n  Top {n_select} by screener ML:")
        print(f"    Avg PnL:    {sel_pnl:+.2f}% (baseline: {base_pnl:+.2f}%)")
        print(f"    Avg WR:     {sel_wr:.1f}% (baseline: {base_wr:.1f}%)")
        print(f"    Improvement: {sel_pnl - base_pnl:+.2f}% PnL, {sel_wr - base_wr:+.1f}% WR")

    # ── Save Model ──
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    joblib.dump(model, MODELS_DIR / "model.joblib")
    joblib.dump(scaler, MODELS_DIR / "scaler.joblib")

    meta = {
        "model_name": "LightGBM",
        "task": "screener_selection",
        "features": FEATURES,
        "target": f"cross_sectional_top{int(TOP_PCT*100)}_bottom{int(BOTTOM_PCT*100)}_by_total_pnl",
        "train_dates": {
            "start": str(train_df.date.min()),
            "end": str(train_df.date.max()),
            "n_days": int(train_df.date.nunique()),
        },
        "test_dates": {
            "start": str(test_df.date.min()),
            "end": str(test_df.date.max()),
            "n_days": int(test_df.date.nunique()),
        },
        "metrics": {
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "precision": float(precision_score(y_test, y_pred)),
            "recall": float(recall_score(y_test, y_pred)),
            "f1": float(f1_score(y_test, y_pred)),
            "auc": float(roc_auc_score(y_test, y_proba)),
        },
        "params": model.get_params(),
        "best_iteration": model.best_iteration_,
        "n_train": len(X_train),
        "n_test": len(X_test),
    }

    with open(MODELS_DIR / "meta.json", "w") as f:
        json.dump(meta, f, indent=2, default=str)

    print(f"\n  Model saved to {MODELS_DIR}/")
    print(f"    model.joblib, scaler.joblib, meta.json")

    return model, scaler, meta


# ── Main ──────────────────────────────────────────────────────────────────────

def build_target_has_winning(df: pd.DataFrame) -> pd.DataFrame:
    """Target = has_winning_trade (binary, 27% positive)."""
    df = df.copy()
    df["target"] = df["has_winning_trade"].astype(int)
    print(f"  Target: has_winning_trade")
    print(f"  Target=1: {(df.target == 1).sum()} ({(df.target == 1).mean()*100:.1f}%)")
    print(f"  Target=0: {(df.target == 0).sum()} ({(df.target == 0).mean()*100:.1f}%)")
    return df


def build_target_positive_pnl(df: pd.DataFrame) -> pd.DataFrame:
    """Target = total_pnl > 0 (only stocks with signals)."""
    df = df[df.total_signals > 0].copy()
    df["target"] = (df["total_pnl"] > 0).astype(int)
    print(f"  Target: total_pnl > 0 (stocks with signals only)")
    print(f"  Target=1: {(df.target == 1).sum()} ({(df.target == 1).mean()*100:.1f}%)")
    print(f"  Target=0: {(df.target == 0).sum()} ({(df.target == 0).mean()*100:.1f}%)")
    return df


def build_target_cross_sectional_aggressive(df: pd.DataFrame) -> pd.DataFrame:
    """Cross-sectional: top 20% = 1, bottom 40% = 0, middle 40% dropped."""
    df = df.copy()
    df["rank_pct"] = df.groupby("date")["total_pnl"].rank(pct=True, method="average")
    df["target"] = np.where(
        df["rank_pct"] >= 0.80, 1,
        np.where(df["rank_pct"] <= 0.40, 0, np.nan)
    )
    n_before = len(df)
    df = df.dropna(subset=["target"])
    df["target"] = df["target"].astype(int)
    print(f"  Target: cross-sectional top20/bottom40")
    print(f"  {n_before} → {len(df)} rows")
    print(f"  Target=1: {(df.target == 1).sum()} ({(df.target == 1).mean()*100:.1f}%)")
    print(f"  Target=0: {(df.target == 0).sum()} ({(df.target == 0).mean()*100:.1f}%)")
    return df


TARGET_BUILDERS = {
    "cross_sectional_30_30": build_cross_sectional_target,
    "has_winning_trade": build_target_has_winning,
    "positive_pnl": build_target_positive_pnl,
    "cross_sectional_20_40": build_target_cross_sectional_aggressive,
}


def train_all_targets(df: pd.DataFrame):
    """Train and compare all target strategies."""
    print("\n" + "=" * 70)
    print("  COMPARING ALL TARGET STRATEGIES")
    print("=" * 70)

    results = []

    for name, builder in TARGET_BUILDERS.items():
        print(f"\n{'━' * 70}")
        print(f"  TARGET: {name}")
        print(f"{'━' * 70}")

        try:
            df_labeled = builder(df)
            train_df, test_df = temporal_split(df_labeled)

            X_train = np.nan_to_num(train_df[FEATURES].values, nan=0, posinf=0, neginf=0)
            y_train = train_df["target"].values
            X_test = np.nan_to_num(test_df[FEATURES].values, nan=0, posinf=0, neginf=0)
            y_test = test_df["target"].values

            scaler = StandardScaler()
            X_train_s = scaler.fit_transform(X_train)
            X_test_s = scaler.transform(X_test)

            n_pos = (y_train == 1).sum()
            n_neg = (y_train == 0).sum()
            scale_pos = n_neg / n_pos if n_pos > 0 else 1.0

            model = LGBMClassifier(
                n_estimators=300, max_depth=5, num_leaves=31,
                min_child_samples=30, learning_rate=0.05,
                subsample=0.8, colsample_bytree=0.8,
                reg_alpha=0.1, reg_lambda=1.0,
                scale_pos_weight=scale_pos,
                random_state=42, n_jobs=-1, verbose=-1,
            )

            val_split = int(len(X_train_s) * 0.9)
            model.fit(
                X_train_s[:val_split], y_train[:val_split],
                eval_set=[(X_train_s[val_split:], y_train[val_split:])],
                callbacks=[__import__("lightgbm").early_stopping(50, verbose=False)],
            )

            y_pred = model.predict(X_test_s)
            y_proba = model.predict_proba(X_test_s)[:, 1]

            acc = accuracy_score(y_test, y_pred)
            prec = precision_score(y_test, y_pred)
            rec = recall_score(y_test, y_pred)
            f1 = f1_score(y_test, y_pred)
            auc = roc_auc_score(y_test, y_proba)

            # Precision at thresholds
            p60 = 0
            p60_n = 0
            mask60 = y_proba >= 0.60
            if mask60.sum() > 0:
                p60 = (mask60 & (y_test == 1)).sum() / mask60.sum()
                p60_n = mask60.sum()

            p70 = 0
            p70_n = 0
            mask70 = y_proba >= 0.70
            if mask70.sum() > 0:
                p70 = (mask70 & (y_test == 1)).sum() / mask70.sum()
                p70_n = mask70.sum()

            # Practical: top 30 selection
            test_with_proba = test_df.copy()
            test_with_proba["screener_prob"] = y_proba
            selected = test_with_proba.groupby("date").apply(
                lambda g: g.nlargest(min(30, len(g)), "screener_prob"),
                include_groups=False,
            ).reset_index(drop=True)
            sel_pnl = selected["total_pnl"].mean()
            sel_wr = selected[selected.total_signals > 0]["win_rate"].mean() * 100 if (selected.total_signals > 0).any() else 0

            print(f"\n  Acc={acc:.3f} | Prec={prec:.3f} | Rec={rec:.3f} | F1={f1:.3f} | AUC={auc:.3f}")
            print(f"  P@0.60={p60:.3f} ({p60_n} sig) | P@0.70={p70:.3f} ({p70_n} sig)")
            print(f"  Top 30: PnL={sel_pnl:+.2f}% | WR={sel_wr:.1f}%")
            print(f"  Best iter: {model.best_iteration_}")

            results.append({
                "target": name,
                "acc": acc, "prec": prec, "rec": rec, "f1": f1, "auc": auc,
                "p60": p60, "p60_n": p60_n, "p70": p70, "p70_n": p70_n,
                "top30_pnl": sel_pnl, "top30_wr": sel_wr,
                "best_iter": model.best_iteration_,
                "n_train": len(X_train), "n_test": len(X_test),
            })

        except Exception as e:
            print(f"  ERROR: {e}")
            import traceback
            traceback.print_exc()

    # Summary table
    print(f"\n\n{'=' * 90}")
    print(f"  SUMMARY — ALL TARGETS")
    print(f"{'=' * 90}")
    print(f"  {'Target':<28s} {'AUC':>5s} {'P@.60':>6s} {'P@.70':>6s} {'Top30 PnL':>10s} {'Top30 WR':>9s}")
    print(f"  {'─'*28} {'─'*5} {'─'*6} {'─'*6} {'─'*10} {'─'*9}")
    for r in sorted(results, key=lambda x: x["auc"], reverse=True):
        print(f"  {r['target']:<28s} {r['auc']:.3f} {r['p60']:.3f} {r['p70']:.3f} {r['top30_pnl']:>+9.2f}% {r['top30_wr']:>8.1f}%")


def main():
    parser = argparse.ArgumentParser(description="Train screener ML model")
    parser.add_argument("--analyze", action="store_true", help="Only analyze data, don't train")
    parser.add_argument("--compare", action="store_true", help="Compare all target strategies")
    args = parser.parse_args()

    df = load_data()

    if args.analyze:
        analyze_data(df)
    elif args.compare:
        train_all_targets(df)
    else:
        analyze_data(df)
        train_screener(df)


if __name__ == "__main__":
    main()
