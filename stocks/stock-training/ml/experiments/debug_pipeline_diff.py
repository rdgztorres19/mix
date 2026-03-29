#!/usr/bin/env python3
"""
Compare features between two pipelines for the same stock+minute:
  A) eval_multiday pipeline: CSV → add_features(full_day) → extract row
  B) backtest pipeline: CSV → build partial candles → build_dataframe() → add_features()

Shows exactly which features differ and why.

Usage:
  cd stock-training/ml
  python3 -m experiments.debug_pipeline_diff --symbol BZAI --date 2026-03-25 --time 09:30
  python3 -m experiments.debug_pipeline_diff --symbol SYNX --date 2026-03-27 --time 10:21
"""

import argparse
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from experiments.predict import build_dataframe, BEST_MODEL_DIR
from experiments.feature_engineer import add_features

import joblib


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--time", required=True)
    args = parser.parse_args()

    # Load model
    with open(BEST_MODEL_DIR / "meta.json") as f:
        meta = json.load(f)
    feature_cols = meta["feature_columns"]
    model = joblib.load(BEST_MODEL_DIR / "model.joblib")
    use_scaler = meta.get("use_scaler", True)
    scaler_path = BEST_MODEL_DIR / "scaler.joblib"
    scaler = joblib.load(scaler_path) if use_scaler and scaler_path.exists() else None

    # Load CSV rows for this symbol+date
    csv_path = Path(__file__).resolve().parent.parent.parent / "data" / "training-v2.csv"
    print(f"\nLoading {args.symbol} on {args.date} from CSV...")

    rows = []
    with open(csv_path) as f:
        header = f.readline().strip().split(",")
        for line in f:
            vals = line.strip().split(",")
            if len(vals) < 5:
                continue
            if vals[0] == args.symbol and vals[1] == args.date:
                rows.append(dict(zip(header, vals)))

    if not rows:
        print(f"  NOT FOUND: {args.symbol} on {args.date}")
        return

    print(f"  Found {len(rows)} candles")

    # Find target candle index
    target_time = args.time
    target_idx = None
    for i, r in enumerate(rows):
        if r.get("candle_time_et") == target_time:
            target_idx = i
            break

    if target_idx is None:
        print(f"  Time {target_time} not found")
        return

    print(f"  Target candle: index {target_idx}, time {target_time}")

    # Build DataFrame
    df_full = pd.DataFrame(rows)
    for col in df_full.columns:
        if col not in ("symbol", "date", "candle_time_et", "session"):
            df_full[col] = pd.to_numeric(df_full[col], errors="coerce").fillna(0)

    # ══════════════════════════════════════════════════════════════════════
    # Pipeline A: eval_multiday (CSV → add_features on FULL day → extract row)
    # ══════════════════════════════════════════════════════════════════════
    print(f"\n{'='*80}")
    print(f"  PIPELINE A: eval_multiday (add_features on full day, {len(df_full)} candles)")
    print(f"{'='*80}")

    df_a = add_features(df_full.copy())
    row_a = df_a.iloc[target_idx]

    # Predict
    vals_a = [float(row_a.get(col, 0)) if pd.notna(row_a.get(col)) else 0.0 for col in feature_cols]
    X_a = np.array([vals_a])
    if use_scaler and scaler is not None:
        X_a = scaler.transform(X_a)
    prob_a = model.predict_proba(X_a)[0]
    prob_a_1 = float(prob_a[1]) if len(prob_a) > 1 else float(prob_a[0])
    print(f"  Probability: {prob_a_1:.4f}")

    # ══════════════════════════════════════════════════════════════════════
    # Pipeline B: backtest (build partial candles → build_dataframe → add_features)
    # ══════════════════════════════════════════════════════════════════════
    print(f"\n{'='*80}")
    print(f"  PIPELINE B: backtest (build_dataframe on {target_idx + 1} candles)")
    print(f"{'='*80}")

    # Build candle history up to target (same as backtest sends)
    history = rows[:target_idx + 1]
    candles = []
    candle_times = []
    candle_idxs = []
    for r in history:
        candles.append({
            "t": int(float(r.get("candle_idx", 0))),
            "o": float(r.get("open", 0)),
            "h": float(r.get("high", 0)),
            "l": float(r.get("low", 0)),
            "c": float(r.get("close", 0)),
            "v": float(r.get("volume", 0)),
        })
        candle_times.append(r.get("candle_time_et", "09:30"))
        candle_idxs.append(int(float(r.get("candle_idx", 0))))

    target_row_csv = rows[target_idx]
    payload = {
        "candles": candles,
        "target_idx": len(candles) - 1,
        "candle_times_et": candle_times,
        "candle_idx_arr": candle_idxs,
        "atr": float(target_row_csv.get("atr", 0)),
        "high_of_day": float(target_row_csv.get("high_of_day", 0)),
        "low_of_day": float(target_row_csv.get("low_of_day", 0)),
        "pre_market_high": float(target_row_csv.get("pre_market_high", 0)),
        "change_pct_at_candle": float(target_row_csv.get("change_pct_at_candle", 0)),
        "shares_outstanding": float(target_row_csv.get("shares_outstanding", 0)),
        "market_cap": float(target_row_csv.get("market_cap", 0)),
        "gap_pct": float(target_row_csv.get("gap_pct", 0)),
        "premarket_volume": float(target_row_csv.get("premarket_volume", 0)),
    }

    df_b = build_dataframe(payload)
    df_b = add_features(df_b)

    b_target_idx = payload["target_idx"]
    if b_target_idx >= len(df_b):
        b_target_idx = len(df_b) - 1
    row_b = df_b.iloc[b_target_idx]

    # Predict
    vals_b = [float(row_b.get(col, 0)) if pd.notna(row_b.get(col)) else 0.0 for col in feature_cols]
    X_b = np.array([vals_b])
    if use_scaler and scaler is not None:
        X_b = scaler.transform(X_b)
    prob_b = model.predict_proba(X_b)[0]
    prob_b_1 = float(prob_b[1]) if len(prob_b) > 1 else float(prob_b[0])
    print(f"  Probability: {prob_b_1:.4f}")

    # ══════════════════════════════════════════════════════════════════════
    # Compare features
    # ══════════════════════════════════════════════════════════════════════
    print(f"\n{'='*80}")
    print(f"  FEATURE COMPARISON: {args.symbol} @ {args.date} {args.time}")
    print(f"  Pipeline A prob: {prob_a_1:.4f} | Pipeline B prob: {prob_b_1:.4f} | Diff: {abs(prob_a_1-prob_b_1):.4f}")
    print(f"{'='*80}")
    print(f"  {'Feature':<35} {'A (eval_multi)':>15} {'B (backtest)':>15} {'Diff':>10} {'RelDiff':>8}")
    print(f"  {'─'*85}")

    diffs = []
    for col in feature_cols:
        va = float(row_a.get(col, 0)) if pd.notna(row_a.get(col)) else 0.0
        vb = float(row_b.get(col, 0)) if pd.notna(row_b.get(col)) else 0.0
        diff = abs(va - vb)
        rel = diff / max(abs(va), 1e-8) if va != 0 else (diff if diff > 0 else 0)
        diffs.append((col, va, vb, diff, rel))

    # Sort by relative difference
    diffs.sort(key=lambda x: x[4], reverse=True)

    major = 0
    for col, va, vb, diff, rel in diffs:
        marker = ""
        if rel > 0.5:
            marker = " ◄◄◄ MAJOR"
            major += 1
        elif rel > 0.1:
            marker = " ◄◄ DIFF"
        elif rel > 0.01:
            marker = " ◄"
        print(f"  {col:<35} {va:>15.6f} {vb:>15.6f} {diff:>10.6f} {rel:>7.1%}{marker}")

    print(f"\n  Summary: {major} MAJOR diffs (>50%), prob diff = {abs(prob_a_1-prob_b_1):.4f}")

    # Show what the probability difference means
    threshold = 0.65
    a_tradeable = prob_a_1 >= threshold
    b_tradeable = prob_b_1 >= threshold
    if a_tradeable != b_tradeable:
        print(f"\n  ⚠️  SIGNAL MISMATCH at threshold {threshold}:")
        print(f"     Pipeline A: {'TRADEABLE' if a_tradeable else 'SKIP'} ({prob_a_1:.4f})")
        print(f"     Pipeline B: {'TRADEABLE' if b_tradeable else 'SKIP'} ({prob_b_1:.4f})")
    else:
        print(f"\n  ✓ Both pipelines agree: {'TRADEABLE' if a_tradeable else 'SKIP'} at threshold {threshold}")


if __name__ == "__main__":
    main()
