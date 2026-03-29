#!/usr/bin/env python3
"""
Quick debug: show probability for every candle of a symbol on a date.
Compares Pipeline A (full-day add_features) vs Pipeline B (partial build_dataframe).

Usage:
  cd stock-training/ml
  python3 -m experiments.debug_prob_compare --symbol SYNX --date 2026-03-27 --threshold 0.65
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
    parser.add_argument("--threshold", type=float, default=0.65)
    parser.add_argument("--from-time", default="09:30")
    parser.add_argument("--to-time", default="11:30")
    args = parser.parse_args()

    from_min = int(args.from_time.split(":")[0]) * 60 + int(args.from_time.split(":")[1])
    to_min = int(args.to_time.split(":")[0]) * 60 + int(args.to_time.split(":")[1])

    with open(BEST_MODEL_DIR / "meta.json") as f:
        meta = json.load(f)
    model = joblib.load(BEST_MODEL_DIR / "model.joblib")
    use_scaler = meta.get("use_scaler", True)
    scaler_path = BEST_MODEL_DIR / "scaler.joblib"
    scaler = joblib.load(scaler_path) if use_scaler and scaler_path.exists() else None
    feature_cols = meta["feature_columns"]

    # Load CSV
    csv_path = Path(__file__).resolve().parent.parent.parent / "data" / "training-v2.csv"
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
        print(f"NOT FOUND: {args.symbol} on {args.date}")
        return

    df = pd.DataFrame(rows)
    for col in df.columns:
        if col not in ("symbol", "date", "candle_time_et", "session"):
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    print(f"\n{args.symbol} on {args.date}: {len(rows)} candles")
    print(f"Model: {meta.get('model_name')} | {meta.get('feature_set')} | {meta.get('target')}")
    print(f"\n{'Time':<6} {'ProbA':>7} {'ProbB':>7} {'Diff':>7} {'A>=thr':>6} {'B>=thr':>6} {'Match':>5}")
    print("─" * 50)

    # Pipeline A: full-day add_features
    df_a = add_features(df.copy())

    mismatches = 0
    for i in range(len(df)):
        time_str = rows[i].get("candle_time_et", "")
        parts = time_str.split(":")
        if len(parts) < 2:
            continue
        minute = int(parts[0]) * 60 + int(parts[1])
        if minute < from_min or minute > to_min:
            continue

        # Pipeline A: extract row from full-day features
        row_a = df_a.iloc[i]
        vals_a = [float(row_a.get(col, 0)) if pd.notna(row_a.get(col)) else 0.0 for col in feature_cols]
        X_a = np.array([vals_a])
        if use_scaler and scaler is not None:
            X_a = scaler.transform(X_a)
        prob_a = float(model.predict_proba(X_a)[0][1])

        # Pipeline B: partial candles → build_dataframe → add_features
        history = rows[:i + 1]
        candles = [{"t": int(float(r.get("candle_idx", 0))),
                     "o": float(r.get("open", 0)),
                     "h": float(r.get("high", 0)),
                     "l": float(r.get("low", 0)),
                     "c": float(r.get("close", 0)),
                     "v": float(r.get("volume", 0))} for r in history]

        payload = {
            "candles": candles,
            "target_idx": len(candles) - 1,
            "candle_times_et": [r.get("candle_time_et", "09:30") for r in history],
            "candle_idx_arr": [int(float(r.get("candle_idx", 0))) for r in history],
            "atr": float(rows[i].get("atr", 0)),
            "high_of_day": float(rows[i].get("high_of_day", 0)),
            "low_of_day": float(rows[i].get("low_of_day", 0)),
            "pre_market_high": float(rows[i].get("pre_market_high", 0)),
            "change_pct_at_candle": float(rows[i].get("change_pct_at_candle", 0)),
            "shares_outstanding": float(rows[i].get("shares_outstanding", 0)),
            "market_cap": float(rows[i].get("market_cap", 0)),
            "gap_pct": float(rows[i].get("gap_pct", 0)),
            "premarket_volume": float(rows[i].get("premarket_volume", 0)),
        }

        df_b = build_dataframe(payload)
        df_b = add_features(df_b)

        # Fix cumulative_volume_ratio (same as predict_batch.py)
        if "cumulative_volume_ratio" in df_b.columns and len(df_b) < 500:
            df_b["cumulative_volume_ratio"] = df_b["cumulative_volume_ratio"] * (len(df_b) / 539.0)

        b_idx = payload["target_idx"]
        if b_idx >= len(df_b):
            b_idx = len(df_b) - 1
        row_b = df_b.iloc[b_idx]
        vals_b = [float(row_b.get(col, 0)) if pd.notna(row_b.get(col)) else 0.0 for col in feature_cols]
        X_b = np.array([vals_b])
        if use_scaler and scaler is not None:
            X_b = scaler.transform(X_b)
        prob_b = float(model.predict_proba(X_b)[0][1])

        a_trade = prob_a >= args.threshold
        b_trade = prob_b >= args.threshold
        match = "✓" if a_trade == b_trade else "✗ DIFF"
        if a_trade != b_trade:
            mismatches += 1

        # Only show if at least one is tradeable or close to threshold
        if prob_a >= args.threshold - 0.05 or prob_b >= args.threshold - 0.05:
            print(f"{time_str:<6} {prob_a:>7.4f} {prob_b:>7.4f} {abs(prob_a-prob_b):>7.4f} {'BUY' if a_trade else 'skip':>6} {'BUY' if b_trade else 'skip':>6} {match}")

    print(f"\nSignal mismatches: {mismatches}")


if __name__ == "__main__":
    main()
