#!/usr/bin/env python3
"""
Predict using the best tuned model from experiments/results/best_model/.
Reads JSON from stdin, writes JSON to stdout.

Two input modes:

1. Full candle history (computes all features from raw candles):
   {"target_idx": N, "candles": [{"t":..,"o":..,"h":..,"l":..,"c":..,"v":..}, ...],
    "atr": 0.35, "high_of_day": 5.8, "_threshold": 0.6}

2. Single candle (legacy fallback — missing features default to 0):
   {"candle_idx": 1, "open": 10, ..., "_threshold": 0.6}
"""

import json
import sys
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# BEST_MODEL_DIR = Path(__file__).resolve().parent / "results" / "best_model" 
BEST_MODEL_DIR = Path(__file__).resolve().parent / "results" / "best_models" / "LightGBM_D_clean_ext_bin_rr10m_ge_2"   # LightGBM, features D_clean_ext, target binario: probabilidad de que en 10 min el RR sea >= 2
# BEST_MODEL_DIR = Path(__file__).resolve().parent / "results" / "best_models" / "LightGBM_D_clean_ext_bin_mfr10m_1atr"  # LightGBM, features D_clean_ext, target binario: probabilidad de que el movimiento favorable máximo en 10 min sea >= 1 ATR
# BEST_MODEL_DIR = Path(__file__).resolve().parent / "results" / "best_models" / "LightGBM_D_clean_ext_mc_rr10m"          # LightGBM, features D_clean_ext, target multiclase: clasifica si en 10 min el resultado esperado es bearish / neutral / bullish según RR
# BEST_MODEL_DIR = Path(__file__).resolve().parent / "results" / "best_models" / "LightGBM_D1_core_momentum_mc_rr10m"     # LightGBM, features D1_core_momentum, target multiclase RR a 10 min; usa solo el bloque core de momentum
# BEST_MODEL_DIR = Path(__file__).resolve().parent / "results" / "best_models" / "XGBoost_D_clean_ext_mc_rr10m"           # XGBoost, features D_clean_ext, target multiclase RR a 10 min
# BEST_MODEL_DIR = Path(__file__).resolve().parent / "results" / "best_models" / "LightGBM_D_all_bin_mfr10m_1p5"         # LightGBM, features D_all, target binario: probabilidad de que el movimiento favorable máximo en 10 min sea >= 1.5%

DEFAULT_THRESHOLD = 0.6


# ---------------------------------------------------------------------------
# Helpers for building a DataFrame from raw candle history (live mode)
# ---------------------------------------------------------------------------

def _ema(arr, span):
    return pd.Series(arr).ewm(span=span, adjust=False).mean().fillna(
        arr[0] if len(arr) else 0
    ).values


def _cumulative_vwap(h, l, c, v):
    tp = (h + l + c) / 3.0
    cum_tpv = np.cumsum(tp * v)
    cum_v = np.cumsum(v)
    cum_v = np.where(cum_v > 0, cum_v, 1)
    return cum_tpv / cum_v


def build_dataframe(data):
    """Build a full DataFrame with base columns from candle history + metadata."""
    candles = data["candles"]
    n = len(candles)

    o = np.array([c["o"] for c in candles], dtype=np.float64)
    h = np.array([c["h"] for c in candles], dtype=np.float64)
    lo = np.array([c["l"] for c in candles], dtype=np.float64)
    c = np.array([c["c"] for c in candles], dtype=np.float64)
    v = np.array([cc["v"] for cc in candles], dtype=np.float64)
    times = [cc.get("t", 0) for cc in candles]

    df = pd.DataFrame({"open": o, "high": h, "low": lo, "close": c, "volume": v})

    # Use original candle_idx from MySQL if provided, otherwise sequential
    candle_idx_arr = data.get("candle_idx_arr")
    if candle_idx_arr and len(candle_idx_arr) == n:
        df["candle_idx"] = np.array(candle_idx_arr, dtype=int)
    else:
        df["candle_idx"] = np.arange(n)

    atr_val = data.get("atr", 0)
    if atr_val and atr_val > 0:
        df["atr"] = atr_val
    else:
        df["atr"] = pd.Series(h - lo).rolling(14, min_periods=1).mean().values

    df["ema9"] = _ema(c, 9)
    df["ema20"] = _ema(c, 20)
    df["vwap"] = _cumulative_vwap(h, lo, c, v)

    hod_val = data.get("high_of_day", 0)
    lod_val = data.get("low_of_day", 0)
    df["high_of_day"] = hod_val if hod_val else np.maximum.accumulate(h)
    df["low_of_day"] = lod_val if lod_val else np.minimum.accumulate(lo)

    df["pre_market_high"] = data.get("pre_market_high", 0)
    df["change_pct_at_candle"] = data.get("change_pct_at_candle", 0)

    for lag, col in [(1, "change_1m"), (5, "change_5m"), (10, "change_10m")]:
        prev = np.roll(c, lag)
        prev[:lag] = c[:lag]
        with np.errstate(divide="ignore", invalid="ignore"):
            pct = (c - prev) / np.where(np.abs(prev) > 1e-6, np.abs(prev), 1)
        pct[:lag] = 0
        df[col] = np.where(np.isfinite(pct), pct, 0)

    running_max = np.maximum.accumulate(h)
    cidx = df["candle_idx"].values
    msince = np.zeros(n, dtype=int)
    hod_i = 0
    for i in range(n):
        if h[i] >= running_max[i]:
            hod_i = i
        msince[i] = int(cidx[i]) - int(cidx[hod_i])
    df["minutes_since_hod"] = msince
    df["momentum_acumulado"] = (c - c[0]) / max(abs(c[0]), 1e-6)

    df["shares_outstanding"] = data.get("shares_outstanding", 0)
    df["market_cap"] = data.get("market_cap", 0)
    df["gap_pct"] = data.get("gap_pct", 0)
    df["premarket_volume"] = data.get("premarket_volume", 0)

    # Use explicit candle_time_et strings from NestJS if provided,
    # otherwise derive from Unix timestamps
    candle_times_et = data.get("candle_times_et")
    if candle_times_et and len(candle_times_et) == n:
        df["candle_time_et"] = candle_times_et
    else:
        et_tz = timezone(timedelta(hours=-4))
        candle_times = []
        for t_val in times:
            if isinstance(t_val, (int, float)) and t_val > 0:
                if t_val > 1e12:          # milliseconds → seconds
                    t_val = t_val / 1000
                dt = datetime.fromtimestamp(t_val, tz=et_tz)
                candle_times.append(f"{dt.hour:02d}:{dt.minute:02d}")
            else:
                candle_times.append("09:30")
        df["candle_time_et"] = candle_times

    return df


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    meta_path = BEST_MODEL_DIR / "meta.json"
    model_path = BEST_MODEL_DIR / "model.joblib"
    scaler_path = BEST_MODEL_DIR / "scaler.joblib"

    for p, name in [(meta_path, "meta.json"), (model_path, "model.joblib")]:
        if not p.exists():
            print(json.dumps({"error": f"{name} not found", "tradeable": False}))
            sys.exit(1)

    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": str(e), "tradeable": False}))
        sys.exit(1)

    with open(meta_path) as f:
        meta = json.load(f)

    feature_cols = meta["feature_columns"]
    is_multiclass = meta.get("is_multiclass", False)
    inv_label_map = meta.get("inv_label_map", {})

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path) if scaler_path.exists() else None
    threshold = float(data.pop("_threshold", DEFAULT_THRESHOLD))

    from feature_engineer import add_features

    if "candles" in data and len(data.get("candles", [])) > 0:
        # ── Mode 2: Full candle history (live/today) ──
        target_idx = int(data.get("target_idx", len(data["candles"]) - 1))
        df = build_dataframe(data)
        df = add_features(df)

        # Fix cumulative_volume_ratio: add_features uses len(group) as the
        # day-length estimate, but in predict mode we only have partial-day
        # candles. Rescale to match training (median day ≈ 539 candles).
        if "cumulative_volume_ratio" in df.columns and len(df) < 500:
            df["cumulative_volume_ratio"] = df["cumulative_volume_ratio"] * (len(df) / 539.0)

        if target_idx >= len(df):
            target_idx = len(df) - 1

        target_row = df.iloc[target_idx]
        row = []
        for col in feature_cols:
            val = target_row.get(col, 0)
            row.append(float(val) if pd.notna(val) else 0.0)
    else:
        # ── Mode 3: Legacy single-candle ──
        row = []
        for col in feature_cols:
            val = data.get(col)
            if val is None:
                val = 0
            try:
                row.append(float(val))
            except (TypeError, ValueError):
                row.append(0)

    X = np.array([row])
    if scaler is not None:
        X = scaler.transform(X)

    probas = model.predict_proba(X)[0]

    if is_multiclass:
        long_idx = None
        for idx_str, orig_label in inv_label_map.items():
            if int(orig_label) == 1:
                long_idx = int(idx_str)
                break
        if long_idx is None:
            long_idx = len(probas) - 1
        prob = float(probas[long_idx])
    else:
        prob = float(probas[1]) if len(probas) > 1 else float(probas[0])

    tradeable = prob >= threshold

    result = {
        "tradeable": bool(tradeable),
        "prob": round(prob, 4),
        "threshold": threshold,
    }

    # Debug mode: return computed feature values for comparison
    if data.get("_debug"):
        debug_features = {}
        for i, col in enumerate(feature_cols):
            debug_features[col] = round(float(row[i]), 6) if np.isfinite(row[i]) else None
        result["debug_features"] = debug_features

    print(json.dumps(result))


if __name__ == "__main__":
    main()
