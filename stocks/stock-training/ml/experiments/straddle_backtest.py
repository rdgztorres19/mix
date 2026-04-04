#!/usr/bin/env python3
"""
straddle_backtest.py — Backtest straddle strategy using vol_exp model.

Uses the volatility expansion model (85%+ accuracy) to predict big moves.
Instead of predicting direction, simulates buying straddles (call + put).
Profit = realized_range - premium_cost.

Usage:
  cd stock-training/ml
  python -m experiments.straddle_backtest
  python -m experiments.straddle_backtest --model XGBoost_V2_full_bin_vol_exp_10m_2atr
  python -m experiments.straddle_backtest --cost 5.0 --horizon 10
"""

import argparse
import json
import sys
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.data_loader import load_df_with_features, temporal_split, prepare_Xy
from experiments.feature_engineer import FEATURE_SETS
from experiments.target_variants import compute_target_variants

BEST_MODELS_DIR = Path(__file__).resolve().parent / "results" / "best_models"

DEFAULT_MODEL = "XGBoost_V2_full_bin_vol_exp_10m_2atr"
DEFAULT_COST = 3.0     # straddle premium as % of stock price
DEFAULT_HORIZON = 10   # candles to measure realized range
DEFAULT_THRESHOLD = 0.80


def compute_realized_range(
    df: pd.DataFrame,
    horizon: int = 10,
) -> np.ndarray:
    """
    For each row, compute (max_high - min_low) / close over next `horizon` bars.
    Groups by (symbol, date) to respect day boundaries.
    This is the realized range a straddle would capture.
    """
    n = len(df)
    result = np.full(n, np.nan, dtype=np.float64)

    group_cols = ["symbol", "date"] if "symbol" in df.columns else ["date"]
    has_groups = all(c in df.columns for c in group_cols)

    if has_groups:
        for _key, grp in df.groupby(group_cols, sort=False):
            idx = grp.index.values
            h = grp["high"].values.astype(np.float64)
            lo = grp["low"].values.astype(np.float64)
            c = grp["close"].values.astype(np.float64)
            ng = len(grp)
            for i in range(ng):
                if i + horizon >= ng or c[i] <= 0:
                    continue
                max_h = np.max(h[i + 1:i + horizon + 1])
                min_l = np.min(lo[i + 1:i + horizon + 1])
                result[idx[i]] = (max_h - min_l) / c[i] * 100  # as %
    else:
        h = df["high"].values.astype(np.float64)
        lo = df["low"].values.astype(np.float64)
        c = df["close"].values.astype(np.float64)
        for i in range(n):
            if i + horizon >= n or c[i] <= 0:
                continue
            max_h = np.max(h[i + 1:i + horizon + 1])
            min_l = np.min(lo[i + 1:i + horizon + 1])
            result[i] = (max_h - min_l) / c[i] * 100

    return result


def straddle_pnl(realized_range_pct: float, premium_cost_pct: float) -> float:
    """
    Straddle P&L = realized_range - premium.
    The most you can lose is the premium. Profit is unlimited.
    """
    return realized_range_pct - premium_cost_pct


def estimate_dynamic_premium(
    atr_rel: float,
    horizon_candles: int,
    iv_multiplier: float = 1.5,
) -> float:
    """
    Estimate straddle premium dynamically based on the stock's current volatility.

    In real options markets:
      premium ≈ price × IV × sqrt(time_to_expiry)

    We approximate IV using realized ATR:
      premium_pct ≈ atr_rel × sqrt(horizon) × iv_multiplier

    iv_multiplier accounts for IV > realized vol (typically 1.3-2.0).
    Higher = more expensive premium = harder to profit.

    Returns: estimated premium as % of stock price.
    """
    # atr_rel is ATR/price (already as ratio, typically 0.02-0.10 for momentum stocks)
    premium = atr_rel * 100 * np.sqrt(horizon_candles) * iv_multiplier
    # Floor: minimum 0.5%, Cap: maximum 20%
    return np.clip(premium, 0.5, 20.0)


def backtest_straddle(
    df: pd.DataFrame,
    model, scaler, meta,
    threshold: float = DEFAULT_THRESHOLD,
    horizon: int = DEFAULT_HORIZON,
    implied_cost_pct: float = DEFAULT_COST,
    cooldown: int = 3,
    dynamic_premium: bool = False,
    iv_multiplier: float = 1.5,
):
    """
    Backtest straddle entries using vol_exp model predictions.

    If dynamic_premium=True, premium is estimated per-trade from the stock's
    current ATR (volatility). This is more realistic because high-IV stocks
    have expensive premiums. implied_cost_pct is ignored when dynamic.

    Returns dict with performance metrics.
    """
    feature_cols = meta.get("feature_columns", meta.get("features", []))
    use_scaler = meta.get("use_scaler", True)

    # Compute realized ranges
    print("  Computing realized ranges...")
    realized = compute_realized_range(df, horizon)
    valid = np.isfinite(realized)

    # Prepare features
    X, _ = prepare_Xy(df[valid], feature_cols, target_col="_dummy" if "_dummy" in df.columns else list(df.columns)[-1])

    # Add dummy target if needed
    if "_dummy" not in df.columns:
        df_valid = df[valid].copy()
        df_valid["_dummy"] = 0
        X = pd.DataFrame(index=df_valid.index)
        for c in feature_cols:
            X[c] = df_valid[c].values if c in df_valid.columns else 0.0
        X = X.fillna(0).replace([np.inf, -np.inf], 0)

    if use_scaler and scaler is not None:
        X_scaled = pd.DataFrame(scaler.transform(X), columns=X.columns, index=X.index)
    else:
        X_scaled = X

    # Predict
    print("  Running predictions...")
    probas = model.predict_proba(X_scaled)
    probs = probas[:, 1] if probas.shape[1] > 1 else probas[:, 0]

    # Get ATR for dynamic premium
    df_valid = df[valid].reset_index(drop=True)
    atr_rel_arr = None
    if dynamic_premium and "atr_rel" in df_valid.columns:
        atr_rel_arr = df_valid["atr_rel"].fillna(0).values.astype(np.float64)
    elif dynamic_premium and "atr" in df_valid.columns and "close" in df_valid.columns:
        atr_vals = df_valid["atr"].fillna(0).values.astype(np.float64)
        close_vals = df_valid["close"].fillna(1).values.astype(np.float64)
        atr_rel_arr = atr_vals / np.maximum(close_vals, 0.01)

    # Simulate trades
    signals = probs >= threshold
    realized_valid = realized[valid]

    trades = []
    cd = 0
    premiums_used = []
    for i in range(len(probs)):
        if cd > 0:
            cd -= 1
            continue
        if signals[i]:
            rr = realized_valid[i]

            if dynamic_premium and atr_rel_arr is not None:
                cost = estimate_dynamic_premium(atr_rel_arr[i], horizon, iv_multiplier)
            else:
                cost = implied_cost_pct

            pnl = straddle_pnl(rr, cost)
            premiums_used.append(cost)
            trades.append({
                "prob": float(probs[i]),
                "realized_range_pct": round(rr, 3),
                "premium_pct": round(cost, 3),
                "pnl_pct": round(pnl, 3),
                "win": pnl > 0,
            })
            cd = cooldown

    if not trades:
        print("  No signals above threshold")
        return {"n_signals": 0}

    wins = sum(1 for t in trades if t["win"])
    total_pnl = sum(t["pnl_pct"] for t in trades)
    avg_pnl = total_pnl / len(trades)
    avg_range = np.mean([t["realized_range_pct"] for t in trades])

    avg_premium = np.mean(premiums_used) if premiums_used else implied_cost_pct

    return {
        "n_signals": len(trades),
        "wins": wins,
        "losses": len(trades) - wins,
        "win_rate": round(wins / len(trades) * 100, 1),
        "avg_pnl_pct": round(avg_pnl, 3),
        "total_pnl_pct": round(total_pnl, 3),
        "avg_realized_range_pct": round(avg_range, 3),
        "avg_premium_pct": round(avg_premium, 3),
        "dynamic_premium": dynamic_premium,
        "iv_multiplier": iv_multiplier if dynamic_premium else None,
        "implied_cost_pct": implied_cost_pct if not dynamic_premium else None,
        "threshold": threshold,
        "horizon": horizon,
    }


def grid_search_straddle(
    df: pd.DataFrame,
    model, scaler, meta,
    thresholds: list[float] = [0.60, 0.70, 0.80, 0.90],
    horizons: list[int] = [5, 10, 20, 30],
    costs: list[float] = [2.0, 3.0, 5.0, 8.0],
    dynamic_premium: bool = False,
    iv_multipliers: list[float] = [1.0, 1.5, 2.0, 2.5],
):
    """Grid search over straddle parameters.

    If dynamic_premium=True, ignores costs and uses iv_multipliers instead.
    Premium is estimated per-trade from ATR × sqrt(horizon) × iv_mult.
    """
    results = []

    if dynamic_premium:
        total = len(thresholds) * len(horizons) * len(iv_multipliers)
        i = 0
        for thr in thresholds:
            for hz in horizons:
                for iv_mult in iv_multipliers:
                    i += 1
                    r = backtest_straddle(df, model, scaler, meta,
                                           threshold=thr, horizon=hz, cooldown=3,
                                           dynamic_premium=True, iv_multiplier=iv_mult)
                    r["combo"] = f"thr={thr} hz={hz} iv_mult={iv_mult}x"
                    results.append(r)
                    if r["n_signals"] > 0:
                        print(f"  [{i}/{total}] thr={thr} hz={hz} iv_mult={iv_mult}x: "
                              f"sig={r['n_signals']} WR={r['win_rate']}% "
                              f"avgPnL={r['avg_pnl_pct']:+.3f}% range={r['avg_realized_range_pct']:.2f}% "
                              f"avg_premium={r['avg_premium_pct']:.2f}%")
    else:
        total = len(thresholds) * len(horizons) * len(costs)
        i = 0
        for thr in thresholds:
            for hz in horizons:
                for cost in costs:
                    i += 1
                    r = backtest_straddle(df, model, scaler, meta,
                                           threshold=thr, horizon=hz, implied_cost_pct=cost, cooldown=3)
                    r["combo"] = f"thr={thr} hz={hz} cost={cost}%"
                    results.append(r)
                    if r["n_signals"] > 0:
                        print(f"  [{i}/{total}] thr={thr} hz={hz} cost={cost}%: "
                              f"sig={r['n_signals']} WR={r['win_rate']}% "
                              f"avgPnL={r['avg_pnl_pct']:+.3f}% range={r['avg_realized_range_pct']:.2f}%")

    # Sort by total PnL
    results.sort(key=lambda r: r.get("total_pnl_pct", 0), reverse=True)
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Model directory name in best_models/")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    parser.add_argument("--horizon", type=int, default=DEFAULT_HORIZON)
    parser.add_argument("--cost", type=float, default=DEFAULT_COST, help="Straddle premium cost as %% of stock price")
    parser.add_argument("--grid", action="store_true", help="Run grid search over parameters")
    parser.add_argument("--dynamic-premium", action="store_true", help="Estimate premium from ATR (realistic)")
    parser.add_argument("--iv-mult", type=float, default=1.5, help="IV multiplier for dynamic premium (1.0-2.5)")
    parser.add_argument("--csv", default=None, help="Custom CSV path")
    parser.add_argument("--max-rows", type=int, default=2000000)
    args = parser.parse_args()

    # Load model
    model_dir = BEST_MODELS_DIR / args.model
    if not model_dir.exists():
        print(f"Model not found: {model_dir}")
        print(f"Available: {[d.name for d in BEST_MODELS_DIR.iterdir() if d.is_dir()]}")
        sys.exit(1)

    model = joblib.load(model_dir / "model.joblib")
    scaler = joblib.load(model_dir / "scaler.joblib") if (model_dir / "scaler.joblib").exists() else None
    with open(model_dir / "meta.json") as f:
        meta = json.load(f)

    print(f"  Model: {args.model}")
    print(f"  Features: {len(meta.get('feature_columns', meta.get('features', [])))}")

    # Load data
    print("  Loading data...")
    t0 = time.time()
    if args.csv:
        from experiments.feature_engineer import add_features
        csv_p = Path(args.csv)
        if not csv_p.is_absolute():
            csv_p = Path(__file__).resolve().parent.parent.parent / args.csv
        df = pd.read_csv(csv_p, low_memory=False)
        if args.max_rows and len(df) > args.max_rows:
            df = df.tail(args.max_rows).reset_index(drop=True)
        df = add_features(df)
    else:
        df = load_df_with_features(filter_valid=True)

    print(f"  Loaded {len(df)} rows in {time.time()-t0:.1f}s")

    if args.grid:
        mode = "DYNAMIC premium (ATR-based)" if args.dynamic_premium else "FIXED premium"
        print(f"\n  Running straddle grid search ({mode})...\n")
        results = grid_search_straddle(df, model, scaler, meta,
                                        dynamic_premium=args.dynamic_premium)

        print(f"\n  TOP 10 by Total PnL:")
        print(f"  {'Combo':<35} {'Signals':>8} {'WR':>6} {'AvgPnL':>8} {'TotalPnL':>10} {'AvgRange':>9} {'AvgPrem':>8}")
        print(f"  {'─'*35} {'─'*8} {'─'*6} {'─'*8} {'─'*10} {'─'*9} {'─'*8}")
        for r in results[:10]:
            if r["n_signals"] == 0:
                continue
            prem = r.get('avg_premium_pct', r.get('implied_cost_pct', 0))
            print(f"  {r['combo']:<35} {r['n_signals']:>8} {r['win_rate']:>5.1f}% "
                  f"{r['avg_pnl_pct']:>+7.3f}% {r['total_pnl_pct']:>+9.3f}% "
                  f"{r['avg_realized_range_pct']:>8.2f}% {prem:>7.2f}%")
    else:
        mode = "DYNAMIC" if args.dynamic_premium else f"FIXED {args.cost}%"
        print(f"\n  Threshold: {args.threshold}  Horizon: {args.horizon}  Premium: {mode}  IV mult: {args.iv_mult}\n")
        result = backtest_straddle(df, model, scaler, meta,
                                    threshold=args.threshold, horizon=args.horizon,
                                    implied_cost_pct=args.cost,
                                    dynamic_premium=args.dynamic_premium,
                                    iv_multiplier=args.iv_mult)

        print(f"\n  {'='*50}")
        print(f"  STRADDLE BACKTEST RESULTS")
        print(f"  {'='*50}")
        for k, v in result.items():
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
