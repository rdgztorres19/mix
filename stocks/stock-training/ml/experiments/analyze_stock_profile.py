#!/usr/bin/env python3
"""
Analyze which stock characteristics correlate with profitable momentum trades.
Runs predict on each stock+day, then groups results by stock profile metrics.

Usage:
  cd stock-training/ml
  python3 -m experiments.analyze_stock_profile
  python3 -m experiments.analyze_stock_profile --threshold 0.65 --tp 4 --sl 2
  python3 -m experiments.analyze_stock_profile --from-date 2026-03-01
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


def categorize(val, bins, labels):
    for i, threshold in enumerate(bins):
        if val < threshold:
            return labels[i]
    return labels[-1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=0.65)
    parser.add_argument("--tp", type=float, default=4.0)
    parser.add_argument("--sl", type=float, default=2.0)
    parser.add_argument("--lookahead", type=int, default=120)
    parser.add_argument("--from-time", default="09:30")
    parser.add_argument("--to-time", default="11:30")
    parser.add_argument("--from-date", type=str)
    parser.add_argument("--to-date", type=str)
    parser.add_argument("--max-days", type=int, default=999)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    from_min = int(args.from_time.split(":")[0]) * 60 + int(args.from_time.split(":")[1])
    to_min = int(args.to_time.split(":")[0]) * 60 + int(args.to_time.split(":")[1])

    # Load model
    with open(BEST_MODEL_DIR / "meta.json") as f:
        meta = json.load(f)
    model = joblib.load(BEST_MODEL_DIR / "model.joblib")
    use_scaler = meta.get("use_scaler", True)
    scaler_path = BEST_MODEL_DIR / "scaler.joblib"
    scaler = joblib.load(scaler_path) if use_scaler and scaler_path.exists() else None
    feature_cols = meta["feature_columns"]
    is_mc = meta.get("is_multiclass", False)

    print(f"\n{'='*90}")
    print(f"  STOCK PROFILE ANALYSIS")
    print(f"  Model: {meta.get('model_name')} | {meta.get('feature_set')} | {meta.get('target')}")
    print(f"  Threshold: {args.threshold} | TP: {args.tp}% | SL: {args.sl}% | LA: {args.lookahead}")
    print(f"{'='*90}\n")

    # Load CSV
    csv_path = Path(__file__).resolve().parent.parent.parent / "data" / "training-v2.csv"
    print(f"Loading {csv_path}...")
    t0 = _time.time()
    df_all = pd.read_csv(csv_path, low_memory=False)
    for col in df_all.columns:
        if col not in ("symbol", "date", "candle_time_et", "session"):
            df_all[col] = pd.to_numeric(df_all[col], errors="coerce").fillna(0)
    print(f"  Loaded {len(df_all)} rows in {_time.time()-t0:.1f}s")

    dates = sorted(df_all["date"].unique())
    if args.from_date:
        dates = [d for d in dates if d >= args.from_date]
    if args.to_date:
        dates = [d for d in dates if d <= args.to_date]
    dates = dates[:args.max_days]
    print(f"  Evaluating {len(dates)} days\n")

    # ── Process each symbol-day ───────────────────────────────────────────

    all_trades = []  # list of dicts with trade info + stock profile

    def process_one_day(date):
        df_day = df_all[df_all["date"] == date].copy()
        symbols = df_day["symbol"].unique()
        day_trades = []

        for sym in symbols:
            df_sym = df_day[df_day["symbol"] == sym].sort_values("candle_idx").reset_index(drop=True)
            if len(df_sym) < 10:
                continue

            df_feat = add_features(df_sym.copy())

            def parse_min(t):
                parts = str(t).split(":")
                return int(parts[0]) * 60 + int(parts[1]) if len(parts) >= 2 else 0

            df_feat["_minute"] = df_feat["candle_time_et"].apply(parse_min)
            in_window = df_feat[(df_feat["_minute"] >= from_min) & (df_feat["_minute"] <= to_min)]
            if in_window.empty:
                continue

            # Stock profile from first candle in window
            first_row = in_window.iloc[0]
            price = float(first_row.get("close", 0))
            gap_pct = float(first_row.get("gap_pct", 0))
            premarket_vol = float(first_row.get("premarket_volume", 0))
            shares_out = float(first_row.get("shares_outstanding", 0))
            market_cap = float(first_row.get("market_cap", 0))
            atr_rel = float(first_row.get("atr", 0)) / max(price, 0.01) * 100 if price > 0 else 0
            pre_market_high = float(first_row.get("pre_market_high", 0))
            pm_change = ((pre_market_high - price * (1 / (1 + gap_pct/100))) / max(price * (1 / (1 + gap_pct/100)), 0.01) * 100) if gap_pct != 0 and price > 0 else 0

            # Compute float rotation at entry
            cum_vol_at_entry = df_sym.iloc[:int(first_row.get("candle_idx", 0)) + 1]["volume"].sum()
            float_rotation = cum_vol_at_entry / shares_out if shares_out > 0 else 0

            # Relative volume (volume of first candle vs avg of previous 20)
            entry_idx_in_sym = int(first_row.get("candle_idx", 0))
            if entry_idx_in_sym >= 20:
                avg_vol_20 = df_sym.iloc[entry_idx_in_sym-20:entry_idx_in_sym]["volume"].mean()
                rvol = float(first_row.get("volume", 0)) / max(avg_vol_20, 1)
            else:
                rvol = 1.0

            # Max gain of the day (for analysis, not for trading)
            day_high = df_sym["high"].max()
            day_open = df_sym.iloc[0]["open"]
            max_day_gain = ((day_high - day_open) / max(day_open, 0.01)) * 100 if day_open > 0 else 0

            # HOD at entry vs current price
            hod_at_entry = float(first_row.get("high_of_day", 0))
            dist_hod_pct = ((price - hod_at_entry) / max(hod_at_entry, 0.01)) * 100 if hod_at_entry > 0 else 0

            # Batch predict
            rows_data = []
            row_indices = []
            for df_idx, row in in_window.iterrows():
                vals = [float(row.get(col, 0)) if pd.notna(row.get(col)) else 0.0 for col in feature_cols]
                rows_data.append(vals)
                row_indices.append(df_idx)

            X = np.array(rows_data)
            if use_scaler and scaler is not None:
                X = scaler.transform(X)

            probas = model.predict_proba(X)
            probs = probas[:, 1] if probas.shape[1] > 1 else probas[:, 0]

            for i, prob in enumerate(probs):
                if prob >= args.threshold:
                    orig_idx = row_indices[i]
                    try:
                        iloc_pos = df_sym.index.get_loc(orig_idx)
                    except KeyError:
                        continue
                    result, pnl = hit_tp_before_sl(df_sym, iloc_pos, args.tp, args.sl, args.lookahead)

                    candle_time = str(in_window.iloc[i].get("candle_time_et", "?"))
                    candle_min = parse_min(candle_time)

                    day_trades.append({
                        "date": date, "symbol": sym, "time": candle_time,
                        "prob": prob, "result": result, "pnl": pnl,
                        # Stock profile
                        "price": price,
                        "gap_pct": gap_pct,
                        "premarket_vol": premarket_vol,
                        "shares_outstanding": shares_out,
                        "market_cap": market_cap,
                        "atr_pct": atr_rel,
                        "float_rotation": float_rotation,
                        "rvol": rvol,
                        "max_day_gain": max_day_gain,
                        "dist_hod_pct": dist_hod_pct,
                        "candle_min": candle_min,
                        "consecutive_green": float(first_row.get("consecutive_green", 0)) if "consecutive_green" in first_row.index else 0,
                    })

        return day_trades

    print("Processing days...")
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process_one_day, d): d for d in dates}
        done = 0
        for fut in as_completed(futures):
            done += 1
            try:
                trades = fut.result()
                all_trades.extend(trades)
                if done % 20 == 0 or done == len(dates):
                    print(f"  {done}/{len(dates)} days, {len(all_trades)} trades so far")
            except Exception as e:
                print(f"  ERROR {futures[fut]}: {e}")

    if not all_trades:
        print("No trades found!")
        return

    df_trades = pd.DataFrame(all_trades)
    total = len(df_trades)
    wins = (df_trades["result"] == "win").sum()
    losses = (df_trades["result"] == "loss").sum()
    decided = wins + losses
    wr = wins / decided * 100 if decided > 0 else 0

    print(f"\n{'='*90}")
    print(f"  OVERALL: {total} trades | {wins}W {losses}L | WR: {wr:.1f}%")
    print(f"{'='*90}\n")

    # ── Analyze by different dimensions ───────────────────────────────────

    dimensions = {
        "Price Range": ("price", [1, 3, 5, 10, 20, 50, 100],
                        ["<$1", "$1-3", "$3-5", "$5-10", "$10-20", "$20-50", "$50-100", "$100+"]),
        "Gap %": ("gap_pct", [0, 2, 5, 10, 20, 40],
                  ["<0% (red)", "0-2%", "2-5%", "5-10%", "10-20%", "20-40%", "40%+"]),
        "ATR %": ("atr_pct", [1, 2, 3, 5, 8],
                  ["<1%", "1-2%", "2-3%", "3-5%", "5-8%", "8%+"]),
        "Float (shares)": ("shares_outstanding", [1e6, 5e6, 20e6, 50e6, 100e6, 500e6],
                           ["<1M", "1-5M", "5-20M", "20-50M", "50-100M", "100-500M", "500M+"]),
        "Float Rotation": ("float_rotation", [0.1, 0.25, 0.5, 1.0, 2.0],
                           ["<0.1x", "0.1-0.25x", "0.25-0.5x", "0.5-1x", "1-2x", "2x+"]),
        "Relative Volume": ("rvol", [0.5, 1, 2, 3, 5, 10],
                            ["<0.5x", "0.5-1x", "1-2x", "2-3x", "3-5x", "5-10x", "10x+"]),
        "Premarket Vol": ("premarket_vol", [1e4, 1e5, 5e5, 1e6, 5e6, 1e7],
                          ["<10K", "10-100K", "100-500K", "500K-1M", "1-5M", "5-10M", "10M+"]),
        "Time of Day": ("candle_min", [575, 585, 600, 630, 660],
                        ["09:30-09:34", "09:35-09:44", "09:45-09:59", "10:00-10:29", "10:30-10:59", "11:00+"]),
        "Max Day Gain %": ("max_day_gain", [5, 10, 20, 30, 50, 100],
                           ["<5%", "5-10%", "10-20%", "20-30%", "30-50%", "50-100%", "100%+"]),
        "Dist from HOD %": ("dist_hod_pct", [-20, -10, -5, -2, 0],
                            ["<-20%", "-20 to -10%", "-10 to -5%", "-5 to -2%", "-2 to 0%", "At/Near HOD"]),
        "Probability": ("prob", [0.55, 0.6, 0.65, 0.7, 0.75, 0.8],
                        ["<55%", "55-60%", "60-65%", "65-70%", "70-75%", "75-80%", "80%+"]),
    }

    for dim_name, (col, bins, labels) in dimensions.items():
        if col not in df_trades.columns:
            continue

        df_trades[f"_cat_{col}"] = df_trades[col].apply(lambda v: categorize(v, bins, labels))

        print(f"\n  {dim_name}")
        print(f"  {'Category':<20} {'Trades':>6} {'Wins':>5} {'Loss':>5} {'WR':>6} {'AvgPnL':>7} {'Edge':>6}")
        print(f"  {'─'*60}")

        for cat in labels:
            subset = df_trades[df_trades[f"_cat_{col}"] == cat]
            if len(subset) == 0:
                continue
            w = (subset["result"] == "win").sum()
            l = (subset["result"] == "loss").sum()
            n = (subset["result"] == "neutral").sum()
            d = w + l
            cat_wr = w / d * 100 if d > 0 else 0
            avg_pnl = subset["pnl"].mean()
            edge = cat_wr - (args.sl / (args.tp + args.sl) * 100)
            marker = " ✓" if edge > 10 else (" ~" if edge > 0 else "")

            print(f"  {cat:<20} {len(subset):>6} {w:>5} {l:>5} {cat_wr:>5.1f}% {avg_pnl:>+6.2f}% {edge:>+5.1f}%{marker}")

    # ── Top performing combinations ───────────────────────────────────────

    print(f"\n{'='*90}")
    print(f"  TOP PERFORMING STOCK PROFILES (min 20 trades)")
    print(f"{'='*90}")

    # Bin key columns
    df_trades["_price_cat"] = df_trades["price"].apply(
        lambda v: categorize(v, [3, 10, 50], ["<$3", "$3-10", "$10-50", "$50+"]))
    df_trades["_gap_cat"] = df_trades["gap_pct"].apply(
        lambda v: categorize(v, [0, 5, 15], ["Red gap", "0-5%", "5-15%", "15%+"]))
    df_trades["_rvol_cat"] = df_trades["rvol"].apply(
        lambda v: categorize(v, [2, 5], ["Low RVOL", "Med RVOL", "High RVOL"]))
    df_trades["_time_cat"] = df_trades["candle_min"].apply(
        lambda v: categorize(v, [600, 660], ["First 30min", "30-90min", "After 11:00"]))

    combo_cols = ["_price_cat", "_gap_cat", "_rvol_cat", "_time_cat"]
    grouped = df_trades.groupby(combo_cols).agg(
        trades=("result", "count"),
        wins=("result", lambda x: (x == "win").sum()),
        losses=("result", lambda x: (x == "loss").sum()),
        avg_pnl=("pnl", "mean"),
    ).reset_index()

    grouped["wr"] = grouped["wins"] / (grouped["wins"] + grouped["losses"]).replace(0, 1) * 100
    grouped["edge"] = grouped["wr"] - (args.sl / (args.tp + args.sl) * 100)
    grouped = grouped[grouped["trades"] >= 20].sort_values("edge", ascending=False)

    print(f"\n  {'Price':<8} {'Gap':<10} {'RVOL':<12} {'Time':<14} {'Trades':>6} {'WR':>6} {'Edge':>6} {'AvgPnL':>7}")
    print(f"  {'─'*80}")

    for _, row in grouped.head(20).iterrows():
        marker = " ✓✓" if row["edge"] > 15 else (" ✓" if row["edge"] > 5 else "")
        print(f"  {row['_price_cat']:<8} {row['_gap_cat']:<10} {row['_rvol_cat']:<12} {row['_time_cat']:<14} {row['trades']:>6} {row['wr']:>5.1f}% {row['edge']:>+5.1f}% {row['avg_pnl']:>+6.2f}%{marker}")

    # Worst performing
    print(f"\n  WORST PERFORMING (avoid these):")
    print(f"  {'─'*80}")
    for _, row in grouped.tail(10).iterrows():
        print(f"  {row['_price_cat']:<8} {row['_gap_cat']:<10} {row['_rvol_cat']:<12} {row['_time_cat']:<14} {row['trades']:>6} {row['wr']:>5.1f}% {row['edge']:>+5.1f}% {row['avg_pnl']:>+6.2f}%")

    print(f"\n{'='*90}\n")


if __name__ == "__main__":
    main()
