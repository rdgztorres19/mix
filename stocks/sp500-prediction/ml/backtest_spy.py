#!/usr/bin/env python3
"""
backtest_spy.py — Backtest for SPY intraday prediction.

Loads raw bars from data/raw/{date}/, runs model prediction candle by candle,
evaluates TP/SL hits in future candles.

Usage:
  cd sp500-prediction
  python -m ml.backtest_spy --date 2026-03-27
  python -m ml.backtest_spy --start 2026-03-01 --end 2026-03-27
  python -m ml.backtest_spy --start 2026-03-01 --end 2026-03-27 --model XGBoost_G_spy_optimized_vs_tb10m_10_07
  python -m ml.backtest_spy --start 2026-03-01 --end 2026-03-27 --tp 0.5 --sl 0.3
"""

import argparse
import gzip
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.feature_engineer import add_features
from ml.target_variants import compute_target_variants
from ml.config import CSV_PATH

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
BEST_MODELS_DIR = Path(__file__).resolve().parent / "results" / "best_models"

DEFAULT_MODEL = "XGBoost_G_spy_optimized_bin_rr10m_ge_2"
DEFAULT_THRESHOLD = 0.70
DEFAULT_TP_PCT = 0.30   # 0.30% TP (SPY moves small)
DEFAULT_SL_PCT = 0.15   # 0.15% SL (2:1 ratio)
DEFAULT_LOOK_AHEAD = 10  # candles to check for TP/SL
DEFAULT_START_TIME = "09:30"
DEFAULT_END_TIME = "11:00"


def parse_time_minutes(t_str: str) -> int:
    parts = t_str.split(":")
    return int(parts[0]) * 60 + int(parts[1])


def load_model(model_dir_name: str):
    model_dir = BEST_MODELS_DIR / model_dir_name
    model = joblib.load(model_dir / "model.joblib")
    scaler = joblib.load(model_dir / "scaler.joblib")
    with open(model_dir / "meta.json") as f:
        meta = json.load(f)
    return model, scaler, meta


def load_day_data(date_str: str):
    """Load SPY + UVXY bars + prev close for a date."""
    day_dir = RAW_DIR / date_str
    if not day_dir.exists():
        return None, None, None

    bars_path = day_dir / "bars-1m.json.gz"
    uvxy_path = day_dir / "uvxy-1m.json.gz"
    pc_path = day_dir / "prev-close.json.gz"

    if not bars_path.exists():
        return None, None, None

    with gzip.open(bars_path) as f:
        spy_bars = json.load(f)

    uvxy_bars = []
    if uvxy_path.exists():
        with gzip.open(uvxy_path) as f:
            uvxy_bars = json.load(f)

    prev_close = 0
    if pc_path.exists():
        with gzip.open(pc_path) as f:
            prev_close = json.load(f)

    return spy_bars, uvxy_bars, prev_close


def bars_to_dataframe(spy_bars: list, uvxy_bars: list, prev_close: float, date_str: str) -> pd.DataFrame:
    """Convert raw bars to DataFrame matching sp500_training.csv format."""
    # Index UVXY by timestamp for matching
    uvxy_by_t = {}
    for b in uvxy_bars:
        uvxy_by_t[b["t"]] = b

    rows = []
    running_hod = -1e18
    running_lod = 1e18
    ema9 = spy_bars[0]["c"] if spy_bars else 0
    ema20 = ema9
    k9 = 2 / 10
    k20 = 2 / 21
    prev_c = spy_bars[0]["c"] if spy_bars else 0

    # Simple ATR calculation
    atr_window = []
    atr_val = 0

    for i, b in enumerate(spy_bars):
        o, h, l, c, v = b["o"], b["h"], b["l"], b["c"], b["v"]
        t_str = b["t"]  # ISO timestamp

        # Parse ET time from ISO
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(t_str.replace("Z", "+00:00"))
        # Convert to ET
        import zoneinfo
        et = dt.astimezone(zoneinfo.ZoneInfo("America/New_York"))
        time_et = et.strftime("%H:%M")

        # ATR
        atr_window.append(h - l)
        if len(atr_window) > 14:
            atr_window.pop(0)
        atr_val = sum(atr_window) / len(atr_window)

        # Running HOD/LOD
        if h > running_hod:
            running_hod = h
        if l < running_lod:
            running_lod = l

        # EMA
        if i > 0:
            ema9 = c * k9 + ema9 * (1 - k9)
            ema20 = c * k20 + ema20 * (1 - k20)

        # VWAP (simple)
        vwap = b.get("vw", c)

        # Changes
        change_pct = (c - prev_close) / max(abs(prev_close), 1e-8) if prev_close > 0 else 0
        change_1m = (c - prev_c) / max(abs(prev_c), 1e-8) if i > 0 else 0
        c5 = spy_bars[i - 5]["c"] if i >= 5 else spy_bars[0]["c"]
        change_5m = (c - c5) / max(abs(c5), 1e-8)
        c10 = spy_bars[i - 10]["c"] if i >= 10 else spy_bars[0]["c"]
        change_10m = (c - c10) / max(abs(c10), 1e-8)

        # Minutes since HOD
        minutes_since_hod = 0
        for k in range(i, -1, -1):
            if spy_bars[k]["h"] >= running_hod:
                minutes_since_hod = i - k
                break

        # UVXY
        uvxy = uvxy_by_t.get(t_str, {})
        uvxy_c = uvxy.get("c", 0)
        uvxy_v = uvxy.get("v", 0)
        uvxy_chg = 0
        if i > 0:
            prev_uvxy_t = spy_bars[i - 1]["t"]
            prev_uvxy = uvxy_by_t.get(prev_uvxy_t, {}).get("c", uvxy_c)
            if prev_uvxy > 0:
                uvxy_chg = (uvxy_c - prev_uvxy) / prev_uvxy

        rows.append({
            "date": date_str,
            "candle_time_et": time_et,
            "candle_idx": i,
            "open": o, "high": h, "low": l, "close": c, "volume": v,
            "atr": atr_val, "vwap": vwap,
            "high_of_day": running_hod, "low_of_day": running_lod,
            "change_pct": change_pct, "ema9": ema9, "ema20": ema20,
            "pre_market_high": 0, "session": "REGULAR",
            "gap_pct": ((spy_bars[0]["o"] - prev_close) / max(abs(prev_close), 1e-8) * 100) if prev_close > 0 else 0,
            "premarket_volume": 0,
            "change_1m": change_1m, "change_5m": change_5m, "change_10m": change_10m,
            "minutes_since_hod": minutes_since_hod,
            "uvxy_close": uvxy_c, "uvxy_change_pct": uvxy_chg, "uvxy_volume": uvxy_v,
            # Placeholder labels (not used for prediction)
            "future_return_5m": 0, "future_return_10m": 0,
            "max_future_return_10m": 0, "min_future_return_10m": 0,
        })
        prev_c = c

    return pd.DataFrame(rows)


def evaluate_trade(spy_bars: list, entry_idx: int, tp_pct: float, sl_pct: float, look_ahead: int, direction: str = "long"):
    """Check if TP or SL is hit in the next look_ahead candles."""
    entry_price = spy_bars[entry_idx]["c"]
    if entry_price <= 0:
        return "neutral", 0

    tp_dec = tp_pct / 100
    sl_dec = sl_pct / 100

    if direction == "long":
        tp_level = entry_price * (1 + tp_dec)
        sl_level = entry_price * (1 - sl_dec)
    else:
        tp_level = entry_price * (1 - tp_dec)
        sl_level = entry_price * (1 + sl_dec)

    n = min(look_ahead, len(spy_bars) - entry_idx - 1)
    for j in range(1, n + 1):
        bar = spy_bars[entry_idx + j]
        h, l = bar["h"], bar["l"]

        if direction == "long":
            touch_tp = h >= tp_level
            touch_sl = l <= sl_level
        else:
            touch_tp = l <= tp_level
            touch_sl = h >= sl_level

        if touch_tp and touch_sl:
            # Both in same candle — use close direction
            cl = bar["c"]
            if direction == "long":
                return ("win", tp_pct) if cl >= bar["o"] else ("loss", -sl_pct)
            else:
                return ("win", tp_pct) if cl <= bar["o"] else ("loss", -sl_pct)
        if touch_tp:
            return "win", tp_pct
        if touch_sl:
            return "loss", -sl_pct

    return "neutral", 0


def backtest_day(
    date_str: str, model, scaler, meta,
    threshold: float, tp_pct: float, sl_pct: float,
    look_ahead: int, start_time: str, end_time: str,
):
    spy_bars, uvxy_bars, prev_close = load_day_data(date_str)
    if spy_bars is None:
        return None

    df = bars_to_dataframe(spy_bars, uvxy_bars, prev_close, date_str)
    df = add_features(df)

    features = meta["features"]
    is_mc = meta.get("is_multiclass", False)

    start_min = parse_time_minutes(start_time)
    end_min = parse_time_minutes(end_time)

    signals = 0
    wins = 0
    losses = 0
    neutrals = 0
    total_pnl = 0

    # Cooldown: skip N candles after a signal to avoid overtrading
    cooldown = 0

    for i in range(len(df)):
        row = df.iloc[i]
        time_et = row["candle_time_et"]
        minute = parse_time_minutes(str(time_et))

        if minute < start_min or minute > end_min:
            continue

        if cooldown > 0:
            cooldown -= 1
            continue

        # Extract features
        X = pd.DataFrame([{col: row.get(col, 0) for col in features}])
        X = X.fillna(0).replace([np.inf, -np.inf], 0)
        X_scaled = pd.DataFrame(scaler.transform(X), columns=X.columns)

        proba = model.predict_proba(X_scaled)
        prob = float(proba[0][1]) if proba.shape[1] >= 2 else float(proba[0][0])

        if prob >= threshold:
            result, pnl = evaluate_trade(spy_bars, i, tp_pct, sl_pct, look_ahead)
            signals += 1
            total_pnl += pnl
            if result == "win":
                wins += 1
            elif result == "loss":
                losses += 1
            else:
                neutrals += 1
            cooldown = 3  # skip 3 candles after signal

    if signals == 0:
        return {"date": date_str, "signals": 0, "wins": 0, "losses": 0, "neutrals": 0, "wr": 0, "avg_pnl": 0}

    return {
        "date": date_str,
        "signals": signals,
        "wins": wins,
        "losses": losses,
        "neutrals": neutrals,
        "wr": round(wins / signals * 100, 1),
        "avg_pnl": round(total_pnl / signals, 3),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=None, help="Single date YYYY-MM-DD")
    parser.add_argument("--start", default=None, help="Start date YYYY-MM-DD")
    parser.add_argument("--end", default=None, help="End date YYYY-MM-DD")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Model directory name")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--tp", type=float, default=DEFAULT_TP_PCT, help="Take profit %%")
    parser.add_argument("--sl", type=float, default=DEFAULT_SL_PCT, help="Stop loss %%")
    parser.add_argument("--look-ahead", type=int, default=DEFAULT_LOOK_AHEAD)
    parser.add_argument("--start-time", default=DEFAULT_START_TIME, help="Start time HH:MM")
    parser.add_argument("--end-time", default=DEFAULT_END_TIME, help="End time HH:MM")
    args = parser.parse_args()

    model, scaler, meta = load_model(args.model)
    print(f"  Model: {args.model}")
    print(f"  Features: {len(meta['features'])}")
    print(f"  Threshold: {args.threshold}  TP: {args.tp}%  SL: {args.sl}%  LookAhead: {args.look_ahead}")
    print(f"  Time: {args.start_time} - {args.end_time}")
    print()

    # Get dates to backtest
    if args.date:
        dates = [args.date]
    elif args.start and args.end:
        all_dates = sorted([d.name for d in RAW_DIR.iterdir() if d.is_dir() and d.name >= args.start and d.name <= args.end])
        dates = all_dates
    else:
        # Default: last 10 trading days
        all_dates = sorted([d.name for d in RAW_DIR.iterdir() if d.is_dir()])
        dates = all_dates[-10:]

    print(f"  Dates: {len(dates)} ({dates[0]} → {dates[-1]})")
    print()

    total_signals = 0
    total_wins = 0
    total_losses = 0
    total_neutrals = 0
    total_pnl = 0

    for date_str in dates:
        result = backtest_day(
            date_str, model, scaler, meta,
            args.threshold, args.tp, args.sl,
            args.look_ahead, args.start_time, args.end_time,
        )
        if result is None:
            continue

        s = result
        if s["signals"] == 0:
            print(f"  {s['date']}:  no signals")
            continue

        total_signals += s["signals"]
        total_wins += s["wins"]
        total_losses += s["losses"]
        total_neutrals += s["neutrals"]
        total_pnl += s["avg_pnl"] * s["signals"]

        wr_color = "✓" if s["wr"] >= 50 else "✗"
        print(f"  {s['date']}: {wr_color} sig={s['signals']:>3d}  W={s['wins']:>2d}  L={s['losses']:>2d}  N={s['neutrals']:>2d}  WR={s['wr']:>5.1f}%  PnL={s['avg_pnl']:>+.3f}%")

    # Summary
    print()
    print("=" * 70)
    if total_signals > 0:
        overall_wr = total_wins / total_signals * 100
        overall_pnl = total_pnl / total_signals
        print(f"  TOTAL: {total_signals} signals | {total_wins}W / {total_losses}L / {total_neutrals}N | WR={overall_wr:.1f}% | Avg PnL={overall_pnl:+.3f}%")
    else:
        print(f"  TOTAL: 0 signals")
    print("=" * 70)


if __name__ == "__main__":
    main()
