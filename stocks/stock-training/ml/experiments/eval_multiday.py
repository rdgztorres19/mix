#!/usr/bin/env python3
"""
Evaluate model over multiple days — TWO modes:
1. Real target precision (does the model predict its own target correctly?)
2. TP/SL P&L (does it make money with fixed take-profit / stop-loss?)

Usage:
  cd stock-training/ml

  # Single model — both evaluations
  python3 -m experiments.eval_multiday --threshold 0.65

  # Specific model
  python3 -m experiments.eval_multiday --model LightGBM_V2_full_bin_rr10m_ge_2 --threshold 0.65

  # All models comparison
  python3 -m experiments.eval_multiday --all-models --threshold 0.65

  # Custom TP/SL
  python3 -m experiments.eval_multiday --threshold 0.65 --tp 2 --sl 1 --lookahead 10
"""

import argparse
import json
import sys
import time as _time
import warnings
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import joblib
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

from experiments.feature_engineer import add_features
from experiments.target_variants import compute_target_variants, TARGET_META

BEST_MODELS_DIR = Path(__file__).resolve().parent / "results" / "best_models"


def _extract_target_arrays(target_obj):
    if isinstance(target_obj, dict):
        return np.asarray(target_obj["y"]), np.asarray(target_obj["valid"], dtype=bool)
    y = np.asarray(target_obj)
    return y, np.ones(len(y), dtype=bool)


# ── TP/SL evaluation ─────────────────────────────────────────────────────────

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


# ── Process one symbol-day ────────────────────────────────────────────────────

def process_symbol_day(df_sym, feature_cols, model, scaler, use_scaler, is_mc,
                       from_min, to_min, threshold, target_name,
                       tp_pct, sl_pct, lookahead):
    """
    Returns list of dicts with both target-based and TP/SL evaluations.
    """
    if len(df_sym) < 5:
        return []

    df_feat = add_features(df_sym.copy())

    # Compute real targets
    targets = compute_target_variants(df_feat)
    target_y, target_valid = _extract_target_arrays(targets.get(target_name, {"y": np.zeros(len(df_feat)), "valid": np.zeros(len(df_feat), dtype=bool)}))

    def parse_min(t):
        parts = str(t).split(":")
        return int(parts[0]) * 60 + int(parts[1]) if len(parts) >= 2 else 0

    df_feat["_minute"] = df_feat["candle_time_et"].apply(parse_min)
    df_feat["_target_y"] = target_y
    df_feat["_target_valid"] = target_valid

    in_window = df_feat[
        (df_feat["_minute"] >= from_min) &
        (df_feat["_minute"] <= to_min)
    ]
    if in_window.empty:
        return []

    # Build feature matrix
    rows_data = []
    meta_info = []  # (df_index, target_value, target_is_valid, iloc_in_sym)

    for df_idx, row in in_window.iterrows():
        vals = [float(row.get(col, 0)) if pd.notna(row.get(col)) else 0.0 for col in feature_cols]
        rows_data.append(vals)
        try:
            iloc_pos = df_sym.index.get_loc(df_idx)
        except KeyError:
            iloc_pos = -1
        meta_info.append((df_idx, int(row["_target_y"]), bool(row["_target_valid"]), iloc_pos))

    if not rows_data:
        return []

    X = np.array(rows_data)
    if use_scaler and scaler is not None:
        X = scaler.transform(X)

    probas = model.predict_proba(X)
    if is_mc:
        probs = probas[:, -1]
    else:
        probs = probas[:, 1] if probas.shape[1] > 1 else probas[:, 0]

    results = []
    for i, prob in enumerate(probs):
        predicted = prob >= threshold
        _, target_val, target_valid_flag, iloc_pos = meta_info[i]

        # Target-based evaluation
        actual_target = target_val == 1 if target_valid_flag else None

        # TP/SL evaluation (only if predicted tradeable)
        tpsl_result = None
        tpsl_pnl = 0.0
        if predicted and iloc_pos >= 0:
            tpsl_result, tpsl_pnl = hit_tp_before_sl(df_sym, iloc_pos, tp_pct, sl_pct, lookahead)

        results.append({
            "prob": float(prob),
            "predicted": predicted,
            "actual_target": actual_target,
            "target_valid": target_valid_flag,
            "tpsl_result": tpsl_result,
            "tpsl_pnl": tpsl_pnl,
        })

    return results


def eval_model(model_dir_name, df_all, dates, from_min, to_min, threshold,
               tp_pct, sl_pct, lookahead, workers, symbol_filter=None):
    model_dir = BEST_MODELS_DIR / model_dir_name

    if not (model_dir / "meta.json").exists():
        print(f"  SKIP {model_dir_name}: no meta.json")
        return None

    with open(model_dir / "meta.json") as f:
        meta = json.load(f)

    model = joblib.load(model_dir / "model.joblib")
    use_scaler = meta.get("use_scaler", True)
    scaler_path = model_dir / "scaler.joblib"
    scaler = joblib.load(scaler_path) if use_scaler and scaler_path.exists() else None
    feature_cols = meta["feature_columns"]
    is_mc = meta.get("is_multiclass", False)
    target_name = meta["target"]
    target_desc = TARGET_META.get(target_name, (False, "?"))[1]

    print(f"\n{'='*80}")
    print(f"  {meta.get('model_name')} | {meta.get('feature_set')} | {target_name}")
    print(f"  Target: {target_desc}")
    print(f"  Threshold: {threshold} | TP: {tp_pct}% | SL: {sl_pct}% | LA: {lookahead}")
    print(f"{'='*80}")

    if symbol_filter:
        print(f"  Filtering to symbol: {symbol_filter}")

    def eval_one_day(date):
        df_day = df_all[df_all["date"] == date].copy()
        symbols = df_day["symbol"].unique()
        if symbol_filter:
            symbols = [s for s in symbols if s == symbol_filter]

        day_all = []
        for sym in symbols:
            df_sym = df_day[df_day["symbol"] == sym].sort_values("candle_idx").reset_index(drop=True)
            results = process_symbol_day(
                df_sym, feature_cols, model, scaler, use_scaler, is_mc,
                from_min, to_min, threshold, target_name,
                tp_pct, sl_pct, lookahead,
            )
            day_all.extend(results)

        # Target metrics
        valid_preds = [r for r in day_all if r["target_valid"]]
        tp = sum(1 for r in valid_preds if r["predicted"] and r["actual_target"])
        fp = sum(1 for r in valid_preds if r["predicted"] and not r["actual_target"])
        tn = sum(1 for r in valid_preds if not r["predicted"] and not r["actual_target"])
        fn = sum(1 for r in valid_preds if not r["predicted"] and r["actual_target"])
        signals = tp + fp
        precision = tp / signals if signals > 0 else 0

        # TP/SL metrics
        trades = [r for r in day_all if r["predicted"] and r["tpsl_result"] is not None]
        wins = sum(1 for r in trades if r["tpsl_result"] == "win")
        losses = sum(1 for r in trades if r["tpsl_result"] == "loss")
        neutrals = sum(1 for r in trades if r["tpsl_result"] == "neutral")
        pnl = sum(r["tpsl_pnl"] for r in trades)
        decided = wins + losses
        wr = wins / decided if decided > 0 else 0

        return {
            "date": date,
            "tp": tp, "fp": fp, "tn": tn, "fn": fn,
            "signals": signals, "precision": precision,
            "wins": wins, "losses": losses, "neutrals": neutrals,
            "pnl": pnl, "wr": wr, "trades": len(trades),
        }

    day_results = []
    t0 = _time.time()

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(eval_one_day, d): d for d in dates}
        for fut in as_completed(futures):
            try:
                res = fut.result()
                day_results.append(res)
                d = res
                prec_s = f"{d['precision']:.0%}" if d['signals'] > 0 else "  -"
                wr_s = f"{d['wr']:.0%}" if (d['wins'] + d['losses']) > 0 else " -"
                avg_pnl = d['pnl'] / d['trades'] if d['trades'] > 0 else 0
                print(f"  {d['date']} | Sig:{d['signals']:>3} Prec:{prec_s:>4} | Trades:{d['trades']:>3} W:{d['wins']:>2} L:{d['losses']:>2} WR:{wr_s:>4} PnL:{avg_pnl:>+5.1f}%")
            except Exception as e:
                print(f"  ERROR {futures[fut]}: {e}")

    elapsed = _time.time() - t0
    day_results.sort(key=lambda x: x["date"])

    # ── Global summary ────────────────────────────────────────────────────

    g_tp = sum(d["tp"] for d in day_results)
    g_fp = sum(d["fp"] for d in day_results)
    g_tn = sum(d["tn"] for d in day_results)
    g_fn = sum(d["fn"] for d in day_results)
    g_signals = g_tp + g_fp
    g_total = g_tp + g_fp + g_tn + g_fn
    g_precision = g_tp / g_signals if g_signals > 0 else 0
    g_recall = g_tp / (g_tp + g_fn) if (g_tp + g_fn) > 0 else 0
    g_accuracy = (g_tp + g_tn) / g_total if g_total > 0 else 0

    g_wins = sum(d["wins"] for d in day_results)
    g_losses = sum(d["losses"] for d in day_results)
    g_neutrals = sum(d["neutrals"] for d in day_results)
    g_trades = sum(d["trades"] for d in day_results)
    g_pnl = sum(d["pnl"] for d in day_results)
    g_decided = g_wins + g_losses
    g_wr = g_wins / g_decided if g_decided > 0 else 0
    g_avg_pnl = g_pnl / g_trades if g_trades > 0 else 0
    breakeven_wr = sl_pct / (tp_pct + sl_pct)

    profitable_days = sum(1 for d in day_results if d["pnl"] > 0 and d["trades"] > 0)
    days_with_trades = sum(1 for d in day_results if d["trades"] > 0)

    print(f"\n{'='*80}")
    print(f"  RESULTS — {len(dates)} days ({elapsed:.0f}s)")
    print(f"{'='*80}")
    print(f"")
    print(f"  TARGET PRECISION (does model predict '{target_name}' correctly?)")
    print(f"  {'─'*60}")
    print(f"  Signals (prob≥{threshold}): {g_signals}")
    print(f"  TP: {g_tp} | FP: {g_fp} | TN: {g_tn} | FN: {g_fn}")
    print(f"  Precision:  {g_precision:.1%}")
    print(f"  Recall:     {g_recall:.1%}")
    print(f"  Accuracy:   {g_accuracy:.1%}")
    print(f"")
    print(f"  TP/SL P&L (TP={tp_pct}% SL={sl_pct}% LA={lookahead})")
    print(f"  {'─'*60}")
    print(f"  Trades: {g_trades}")
    print(f"  Wins: {g_wins} | Losses: {g_losses} | Neutrals: {g_neutrals}")
    print(f"  Win Rate:      {g_wr:.1%}")
    print(f"  Avg PnL/trade: {g_avg_pnl:+.2f}%")
    print(f"  Total PnL:     {g_pnl:+.1f}%")
    print(f"  Profitable days: {profitable_days}/{days_with_trades}")
    print(f"  Breakeven WR:  {breakeven_wr:.1%}")
    print(f"{'='*80}")

    return {
        "model": model_dir_name,
        "target": target_name,
        "threshold": threshold,
        "precision": g_precision, "recall": g_recall, "accuracy": g_accuracy,
        "signals": g_signals,
        "wr": g_wr, "avg_pnl": g_avg_pnl, "total_pnl": g_pnl,
        "trades": g_trades, "wins": g_wins, "losses": g_losses,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-time", default="04:00", help="Default: 04:00 (full day)")
    parser.add_argument("--to-time", default="20:00", help="Default: 20:00 (full day)")
    parser.add_argument("--threshold", type=float, default=0.65)
    parser.add_argument("--tp", type=float, default=4.0)
    parser.add_argument("--sl", type=float, default=2.0)
    parser.add_argument("--lookahead", type=int, default=120)
    parser.add_argument("--dates", nargs="*", help="Specific dates: --dates 2026-03-25 2026-03-26")
    parser.add_argument("--from-date", type=str, help="Start date: --from-date 2026-03-01")
    parser.add_argument("--to-date", type=str, help="End date: --to-date 2026-03-27")
    parser.add_argument("--max-days", type=int, default=999)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--model", type=str, help="Specific model dir name")
    parser.add_argument("--all-models", action="store_true")
    parser.add_argument("--symbol", type=str, help="Filter to a specific symbol: --symbol SYNX")
    args = parser.parse_args()

    from_min = int(args.from_time.split(":")[0]) * 60 + int(args.from_time.split(":")[1])
    to_min = int(args.to_time.split(":")[0]) * 60 + int(args.to_time.split(":")[1])

    csv_path = Path(__file__).resolve().parent.parent.parent / "data" / "training-v2.csv"
    print(f"Loading {csv_path}...")
    t0 = _time.time()
    df_all = pd.read_csv(csv_path, low_memory=False)
    for col in df_all.columns:
        if col not in ("symbol", "date", "candle_time_et", "session"):
            df_all[col] = pd.to_numeric(df_all[col], errors="coerce").fillna(0)
    print(f"  Loaded {len(df_all)} rows in {_time.time()-t0:.1f}s")

    dates = sorted(df_all["date"].unique())
    if args.dates:
        dates = [d for d in dates if d in args.dates]
    if args.from_date:
        dates = [d for d in dates if d >= args.from_date]
    if args.to_date:
        dates = [d for d in dates if d <= args.to_date]
    dates = dates[:args.max_days]
    print(f"  Evaluating {len(dates)} days")

    if args.all_models:
        model_dirs = sorted([d.name for d in BEST_MODELS_DIR.iterdir() if d.is_dir() and (d / "meta.json").exists()])
    elif args.model:
        model_dirs = [args.model]
    else:
        from experiments.predict import BEST_MODEL_DIR
        model_dirs = [BEST_MODEL_DIR.name]

    all_results = []
    for model_dir in model_dirs:
        result = eval_model(model_dir, df_all, dates, from_min, to_min, args.threshold,
                           args.tp, args.sl, args.lookahead, args.workers,
                           symbol_filter=args.symbol)
        if result:
            all_results.append(result)

    if len(all_results) > 1:
        print(f"\n{'='*100}")
        print(f"  COMPARISON — threshold={args.threshold} | TP={args.tp}% SL={args.sl}% LA={args.lookahead}")
        print(f"{'='*100}")
        print(f"  {'Model':<50} {'Sig':>5} {'Prec':>6} {'Trades':>6} {'WR':>5} {'AvgPnL':>7} {'TotPnL':>8}")
        print(f"  {'─'*95}")
        all_results.sort(key=lambda x: x["total_pnl"], reverse=True)
        for r in all_results:
            print(f"  {r['model']:<50} {r['signals']:>5} {r['precision']:>5.1%} {r['trades']:>6} {r['wr']:>4.1%} {r['avg_pnl']:>+6.2f}% {r['total_pnl']:>+7.1f}%")
        print(f"{'='*100}\n")


if __name__ == "__main__":
    main()
