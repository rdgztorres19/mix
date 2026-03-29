#!/usr/bin/env python3
"""
Debug: compare features between training CSV and live prediction for same stock+minute.
Shows which features differ significantly between what the model saw in training
vs what it receives during backtest prediction.

Usage:
  cd stock-training/ml
  echo '{"candles":[...], "target_idx":5, ...}' | python3 -m experiments.debug_feature_diff --csv-symbol BZAI --csv-date 2026-03-25 --csv-time 09:30
"""

import json
import sys
import argparse
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from experiments.predict import build_dataframe, BEST_MODEL_DIR
from experiments.feature_engineer import add_features
from experiments.data_loader import load_base_df

import joblib


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv-symbol", required=True)
    parser.add_argument("--csv-date", required=True)
    parser.add_argument("--csv-time", required=True)
    args = parser.parse_args()

    # Load model meta to get feature columns
    with open(BEST_MODEL_DIR / "meta.json") as f:
        meta = json.load(f)
    feature_cols = meta["feature_columns"]

    # ── 1. Load from CSV (what the model was trained on) ──
    print(f"\n{'='*70}")
    print(f"  Loading CSV for {args.csv_symbol} @ {args.csv_date} {args.csv_time}")
    print(f"{'='*70}")

    csv_path = Path(__file__).resolve().parent.parent.parent / "data" / "training-v2.csv"
    print(f"  CSV: {csv_path}")

    csv_row = None
    with open(csv_path) as f:
        header = f.readline().strip().split(",")
        for line in f:
            vals = line.strip().split(",")
            if len(vals) < 5:
                continue
            row = dict(zip(header, vals))
            if (row.get("symbol") == args.csv_symbol and
                row.get("date") == args.csv_date and
                row.get("candle_time_et") == args.csv_time):
                csv_row = row
                break

    if not csv_row:
        print(f"  NOT FOUND in CSV!")
        sys.exit(1)

    # Load full day for this symbol to compute features
    csv_rows = []
    with open(csv_path) as f:
        header = f.readline().strip().split(",")
        for line in f:
            vals = line.strip().split(",")
            if len(vals) < 5:
                continue
            row = dict(zip(header, vals))
            if row.get("symbol") == args.csv_symbol and row.get("date") == args.csv_date:
                csv_rows.append(row)

    print(f"  Found {len(csv_rows)} CSV rows for {args.csv_symbol} on {args.csv_date}")

    # Build DataFrame from CSV rows
    df_csv = pd.DataFrame(csv_rows)
    for col in df_csv.columns:
        if col not in ("symbol", "date", "candle_time_et", "session"):
            df_csv[col] = pd.to_numeric(df_csv[col], errors="coerce").fillna(0)

    df_csv_feat = add_features(df_csv)

    # Find the target row
    target_mask = df_csv_feat["candle_time_et"] == args.csv_time
    if not target_mask.any():
        print(f"  Time {args.csv_time} not found after add_features")
        sys.exit(1)
    csv_target = df_csv_feat.loc[target_mask].iloc[0]

    # ── 2. Load from stdin (what the backtest sends) ──
    print(f"\n  Waiting for JSON payload on stdin...")
    print(f"  (paste backtest payload and press Ctrl+D)\n")

    payload_str = sys.stdin.read()
    data = json.loads(payload_str)

    df_pred = build_dataframe(data)
    df_pred = add_features(df_pred)

    target_idx = int(data.get("target_idx", len(data["candles"]) - 1))
    if target_idx >= len(df_pred):
        target_idx = len(df_pred) - 1
    pred_target = df_pred.iloc[target_idx]

    # ── 3. Compare features ──
    print(f"\n{'='*70}")
    print(f"  FEATURE COMPARISON: {args.csv_symbol} @ {args.csv_time}")
    print(f"  {'Feature':<35} {'CSV (training)':>15} {'Predict (backtest)':>18} {'Diff':>10}")
    print(f"{'='*70}")

    diffs = []
    for col in feature_cols:
        csv_val = float(csv_target.get(col, 0)) if pd.notna(csv_target.get(col)) else 0.0
        pred_val = float(pred_target.get(col, 0)) if pd.notna(pred_target.get(col)) else 0.0

        diff = abs(csv_val - pred_val)
        rel_diff = diff / max(abs(csv_val), 1e-8) if csv_val != 0 else (diff if diff > 0 else 0)

        diffs.append((col, csv_val, pred_val, diff, rel_diff))

    # Sort by relative difference
    diffs.sort(key=lambda x: x[4], reverse=True)

    for col, csv_val, pred_val, diff, rel_diff in diffs:
        marker = ""
        if rel_diff > 0.5:
            marker = " <<<< MAJOR"
        elif rel_diff > 0.1:
            marker = " << DIFF"

        print(f"  {col:<35} {csv_val:>15.6f} {pred_val:>18.6f} {rel_diff:>9.1%}{marker}")

    # Summary
    major = sum(1 for _, _, _, _, rd in diffs if rd > 0.5)
    medium = sum(1 for _, _, _, _, rd in diffs if 0.1 < rd <= 0.5)
    print(f"\n  Summary: {major} MAJOR diffs (>50%), {medium} medium diffs (10-50%), {len(diffs)} total features")


if __name__ == "__main__":
    main()
