#!/usr/bin/env python3
"""
Find the best TP/SL combination for the current model.
Tests many TP/SL combos across all days and ranks by profitability.

Usage:
  cd stock-training/ml
  python3 -m experiments.find_best_tpsl
  python3 -m experiments.find_best_tpsl --threshold 0.65 --workers 4
  python3 -m experiments.find_best_tpsl --model LightGBM_V2_full_bin_rr10m_ge_2
"""

import argparse
import json
import time as _time
import warnings
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import joblib
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from experiments.predict import BEST_MODEL_DIR
from experiments.feature_engineer import add_features

BEST_MODELS_DIR = Path(__file__).resolve().parent / "results" / "best_models"

# TP/SL combinations to test
TPSL_COMBOS = [
    # (TP%, SL%, lookAhead)
    # Ratio 2:1
    (1.0, 0.5, 10),
    (1.5, 0.75, 10),
    (2.0, 1.0, 10),
    (2.0, 1.0, 20),
    (2.0, 1.0, 30),
    (3.0, 1.5, 10),
    (3.0, 1.5, 20),
    (3.0, 1.5, 30),
    (3.0, 1.5, 60),
    (4.0, 2.0, 10),
    (4.0, 2.0, 20),
    (4.0, 2.0, 30),
    (4.0, 2.0, 60),
    (4.0, 2.0, 120),
    (5.0, 2.5, 30),
    (5.0, 2.5, 60),
    (6.0, 3.0, 60),
    # Ratio 3:1
    (1.5, 0.5, 10),
    (2.0, 0.7, 10),
    (2.0, 0.7, 20),
    (3.0, 1.0, 10),
    (3.0, 1.0, 20),
    (3.0, 1.0, 30),
    (4.0, 1.3, 30),
    (4.0, 1.3, 60),
    # Ratio 1.5:1
    (1.5, 1.0, 10),
    (2.0, 1.3, 10),
    (2.0, 1.3, 20),
    (3.0, 2.0, 20),
    (3.0, 2.0, 30),
    (3.0, 2.0, 60),
    # Tight scalp
    (0.5, 0.25, 5),
    (0.75, 0.5, 5),
    (1.0, 0.5, 5),
    (1.0, 0.75, 5),
]


def hit_tp_before_sl(df_sym, entry_idx, tp_pct, sl_pct, lookahead):
    entry_close = df_sym.iloc[entry_idx]["close"]
    if entry_close <= 0:
        return "neutral", 0.0

    level_up = entry_close * (1 + tp_pct / 100)
    level_down = entry_close * (1 - sl_pct / 100)
    prev_close = entry_close
    n = min(lookahead, len(df_sym) - entry_idx - 1)

    for j in range(1, n + 1):
        c = df_sym.iloc[entry_idx + j]
        o, h, l, cl = c["open"], c["high"], c["low"], c["close"]

        if prev_close < o and prev_close < level_up <= o:
            return "win", tp_pct
        if prev_close > o and o <= level_down < prev_close:
            return "loss", -sl_pct

        touch_up = h >= level_up
        touch_down = l <= level_down

        if touch_up and touch_down:
            return ("loss", -sl_pct) if cl >= o else ("win", tp_pct)
        if touch_up:
            return "win", tp_pct
        if touch_down:
            return "loss", -sl_pct
        prev_close = cl

    return "neutral", 0.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-time", default="09:30")
    parser.add_argument("--to-time", default="11:30")
    parser.add_argument("--threshold", type=float, default=0.65)
    parser.add_argument("--max-days", type=int, default=999)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--model", type=str, help="Model dir name")
    args = parser.parse_args()

    from_min = int(args.from_time.split(":")[0]) * 60 + int(args.from_time.split(":")[1])
    to_min = int(args.to_time.split(":")[0]) * 60 + int(args.to_time.split(":")[1])

    # Load model
    if args.model:
        model_dir = BEST_MODELS_DIR / args.model
    else:
        model_dir = BEST_MODEL_DIR

    with open(model_dir / "meta.json") as f:
        meta = json.load(f)

    model = joblib.load(model_dir / "model.joblib")
    use_scaler = meta.get("use_scaler", True)
    scaler_path = model_dir / "scaler.joblib"
    scaler = joblib.load(scaler_path) if use_scaler and scaler_path.exists() else None
    feature_cols = meta["feature_columns"]
    is_mc = meta.get("is_multiclass", False)

    print(f"\n{'='*80}")
    print(f"  FIND BEST TP/SL")
    print(f"  Model: {meta.get('model_name')} | {meta.get('feature_set')} | {meta.get('target')}")
    print(f"  Window: {args.from_time}-{args.to_time} | Threshold: {args.threshold}")
    print(f"  Testing {len(TPSL_COMBOS)} TP/SL combinations")
    print(f"{'='*80}\n")

    # Load CSV
    csv_path = Path(__file__).resolve().parent.parent.parent / "data" / "training-v2.csv"
    print(f"Loading {csv_path}...")
    t0 = _time.time()
    df_all = pd.read_csv(csv_path, low_memory=False)
    for col in df_all.columns:
        if col not in ("symbol", "date", "candle_time_et", "session"):
            df_all[col] = pd.to_numeric(df_all[col], errors="coerce").fillna(0)

    dates = sorted(df_all["date"].unique())[:args.max_days]
    print(f"  Loaded {len(df_all)} rows, {len(dates)} days in {_time.time()-t0:.1f}s")

    # ── Step 1: Get all tradeable signals across all days ─────────────────

    print(f"\n  Step 1: Finding all tradeable signals (prob >= {args.threshold})...\n")

    def parse_min(t):
        parts = str(t).split(":")
        return int(parts[0]) * 60 + int(parts[1]) if len(parts) >= 2 else 0

    all_signals = []  # list of (date, symbol, iloc_in_sym, df_sym_ref)

    # Store df_sym references for TP/SL evaluation
    sym_day_cache = {}

    for di, date in enumerate(dates):
        df_day = df_all[df_all["date"] == date].copy()
        symbols = df_day["symbol"].unique()

        for sym in symbols:
            df_sym = df_day[df_day["symbol"] == sym].sort_values("candle_idx").reset_index(drop=True)
            if len(df_sym) < 5:
                continue

            df_feat = add_features(df_sym.copy())
            df_feat["_minute"] = df_feat["candle_time_et"].apply(parse_min)

            in_window = df_feat[
                (df_feat["_minute"] >= from_min) &
                (df_feat["_minute"] <= to_min)
            ]
            if in_window.empty:
                continue

            # Predict batch
            rows_data = []
            window_indices = []
            for df_idx, row in in_window.iterrows():
                vals = [float(row.get(col, 0)) if pd.notna(row.get(col)) else 0.0 for col in feature_cols]
                rows_data.append(vals)
                window_indices.append(df_idx)

            X = np.array(rows_data)
            if use_scaler and scaler is not None:
                X = scaler.transform(X)

            probas = model.predict_proba(X)
            probs = probas[:, 1] if probas.shape[1] > 1 else probas[:, 0]

            # Collect tradeable signals
            cache_key = f"{date}_{sym}"
            for i, prob in enumerate(probs):
                if prob >= args.threshold:
                    if cache_key not in sym_day_cache:
                        sym_day_cache[cache_key] = df_sym
                    iloc_pos = df_sym.index.get_loc(window_indices[i]) if window_indices[i] in df_sym.index else -1
                    if iloc_pos >= 0:
                        all_signals.append((date, sym, iloc_pos, cache_key))

        if (di + 1) % 10 == 0 or di == len(dates) - 1:
            print(f"    Processed {di+1}/{len(dates)} days, {len(all_signals)} signals so far")

    print(f"\n  Total tradeable signals: {len(all_signals)}")

    # ── Step 2: Evaluate each TP/SL combo over all signals ────────────────

    print(f"\n  Step 2: Evaluating {len(TPSL_COMBOS)} TP/SL combos...\n")

    results = []

    for ci, (tp, sl, la) in enumerate(TPSL_COMBOS):
        wins = 0
        losses = 0
        neutrals = 0
        total_pnl = 0.0

        for date, sym, iloc_pos, cache_key in all_signals:
            df_sym = sym_day_cache[cache_key]
            result, pnl = hit_tp_before_sl(df_sym, iloc_pos, tp, sl, la)
            if result == "win":
                wins += 1
                total_pnl += tp
            elif result == "loss":
                losses += 1
                total_pnl -= sl
            else:
                neutrals += 1

        decided = wins + losses
        wr = wins / decided if decided > 0 else 0
        trades = wins + losses + neutrals
        avg_pnl = total_pnl / trades if trades > 0 else 0
        breakeven = sl / (tp + sl)
        edge = wr - breakeven

        results.append({
            "tp": tp, "sl": sl, "la": la,
            "ratio": tp / sl,
            "wins": wins, "losses": losses, "neutrals": neutrals,
            "trades": trades, "wr": wr, "avg_pnl": avg_pnl,
            "total_pnl": total_pnl, "breakeven": breakeven, "edge": edge,
        })

    # Sort by total PnL
    results.sort(key=lambda x: x["total_pnl"], reverse=True)

    # ── Print results ─────────────────────────────────────────────────────

    print(f"\n{'='*110}")
    print(f"  RESULTS — {len(all_signals)} signals across {len(dates)} days")
    print(f"{'='*110}")
    print(f"  {'TP':>5} {'SL':>5} {'LA':>4} {'Ratio':>5} | {'Trades':>6} {'Wins':>5} {'Loss':>5} {'Neut':>5} | {'WR':>6} {'BrkEvn':>6} {'Edge':>6} | {'AvgPnL':>7} {'TotPnL':>9}")
    print(f"  {'─'*105}")

    for r in results:
        wr_color = "✓" if r["edge"] > 0 else "✗"
        print(
            f"  {r['tp']:>5.1f} {r['sl']:>5.2f} {r['la']:>4} {r['ratio']:>5.1f} | "
            f"{r['trades']:>6} {r['wins']:>5} {r['losses']:>5} {r['neutrals']:>5} | "
            f"{r['wr']:>5.1%} {r['breakeven']:>5.1%} {r['edge']:>+5.1%} | "
            f"{r['avg_pnl']:>+6.2f}% {r['total_pnl']:>+8.1f}% {wr_color}"
        )

    # Top 5
    print(f"\n  TOP 5:")
    for i, r in enumerate(results[:5]):
        print(f"  #{i+1} TP={r['tp']}% SL={r['sl']}% LA={r['la']} → WR={r['wr']:.1%} Edge={r['edge']:+.1%} AvgPnL={r['avg_pnl']:+.2f}% TotalPnL={r['total_pnl']:+.0f}%")

    print(f"\n{'='*110}\n")


if __name__ == "__main__":
    main()
