#!/usr/bin/env python3
"""
predict.py — Inference intradía para S&P 500 (SPY) 1-min candles.
Reads JSON from stdin, writes JSON to stdout.

Input format:
{
  "target_idx": 45,
  "candles": [{"t": ms, "o": X, "h": X, "l": X, "c": X, "v": X}, ...],
  "uvxy_candles": [{"c": X, "v": X}, ...],
  "atr": 0.35,
  "high_of_day": 591.2,
  "low_of_day": 588.5,
  "pre_market_high": 590.8,
  "candle_times_et": ["09:30", "09:31", ...],
  "candle_idx_arr": [0, 1, 2, ...],
  "gap_pct": 0.15,
  "premarket_volume": 1500000,
  "_threshold": 0.6,
  "_model_dir": "LightGBM_G_spy_optimized_vs_tb10m_15_10"
}

Output:
{
  "tradeable": true,
  "prob": 0.73,
  "threshold": 0.6,
  "close": 590.5,
  "ema9": 590.3,
  "ema20": 589.8,
  "vwap": 589.5
}
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.feature_engineer import add_features

BEST_MODELS_DIR = Path(__file__).resolve().parent / "results" / "best_models"


def _find_model_dir(model_dir_name: str | None = None) -> Path:
    if model_dir_name:
        d = BEST_MODELS_DIR / model_dir_name
        if d.exists():
            return d
    if BEST_MODELS_DIR.exists():
        dirs = [d for d in BEST_MODELS_DIR.iterdir() if d.is_dir() and (d / "model.joblib").exists()]
        if dirs:
            return dirs[0]
    raise FileNotFoundError(f"No trained model found in {BEST_MODELS_DIR}")


def _build_dataframe(payload: dict) -> pd.DataFrame:
    """Build DataFrame from candle history payload (same format as build-csv.ts output)."""
    candles = payload["candles"]
    target_idx = payload.get("target_idx", len(candles) - 1)
    candle_times = payload.get("candle_times_et", [])
    candle_idxs = payload.get("candle_idx_arr", list(range(len(candles))))
    atr_val = payload.get("atr", 0)
    hod = payload.get("high_of_day", 0)
    lod = payload.get("low_of_day", 0)
    pmh = payload.get("pre_market_high", 0)
    gap_pct = payload.get("gap_pct", 0)
    pm_vol = payload.get("premarket_volume", 0)
    date_str = payload.get("date", "2026-01-01")
    uvxy_candles = payload.get("uvxy_candles", [])  # Optional UVXY bars

    rows = []
    # Build running indicators
    vwap_tpv = 0
    vwap_vol = 0
    running_hod = -1e18
    running_lod = 1e18
    ema9 = candles[0]["c"] if candles else 0
    ema20 = ema9
    k9 = 2 / 10
    k20 = 2 / 21
    prev_close = candles[0]["c"] if candles else 0
    first_open = candles[0]["o"] if candles else 0
    prev_close_day = payload.get("prev_close", first_open)

    for i, c in enumerate(candles):
        o, h, l, cl, v = c["o"], c["h"], c["l"], c["c"], c["v"]

        tp = (h + l + cl) / 3
        vwap_tpv += tp * v
        vwap_vol += v
        vwap = vwap_tpv / max(vwap_vol, 1)

        if h > running_hod:
            running_hod = h
        if l < running_lod:
            running_lod = l

        if i > 0:
            ema9 = cl * k9 + ema9 * (1 - k9)
            ema20 = cl * k20 + ema20 * (1 - k20)

        change_pct = (cl - prev_close_day) / max(abs(prev_close_day), 1e-8) if prev_close_day > 0 else 0

        change_1m = (cl - prev_close) / max(abs(prev_close), 1e-8) if i > 0 else 0
        c5 = candles[i - 5]["c"] if i >= 5 else first_open
        change_5m = (cl - c5) / max(abs(c5), 1e-8)
        c10 = candles[i - 10]["c"] if i >= 10 else first_open
        change_10m = (cl - c10) / max(abs(c10), 1e-8)

        time_et = candle_times[i] if i < len(candle_times) else "09:30"

        # UVXY data for this candle (VIX proxy)
        uvxy_c_val = 0.0
        uvxy_chg_val = 0.0
        uvxy_v_val = 0.0
        if i < len(uvxy_candles):
            uc = uvxy_candles[i]
            uvxy_c_val = uc.get("c", 0)
            uvxy_v_val = uc.get("v", 0)
            if i == 0 and uvxy_c_val > 0:
                uvxy_chg_val = 0
            elif uvxy_c_val > 0 and i > 0 and len(uvxy_candles) > i - 1:
                prev_uvxy = uvxy_candles[i - 1].get("c", uvxy_c_val)
                uvxy_chg_val = (uvxy_c_val - prev_uvxy) / max(abs(prev_uvxy), 1e-8) if prev_uvxy > 0 else 0

        rows.append({
            "date": date_str,
            "candle_time_et": time_et,
            "candle_idx": candle_idxs[i] if i < len(candle_idxs) else i,
            "open": o, "high": h, "low": l, "close": cl, "volume": v,
            "atr": atr_val, "vwap": vwap,
            "high_of_day": running_hod, "low_of_day": running_lod,
            "change_pct": change_pct, "ema9": ema9, "ema20": ema20,
            "pre_market_high": pmh, "session": "REGULAR",
            "gap_pct": gap_pct, "premarket_volume": pm_vol,
            "change_1m": change_1m, "change_5m": change_5m, "change_10m": change_10m,
            "minutes_since_hod": 0,  # recomputed by feature engineer
            "uvxy_close": uvxy_c_val, "uvxy_change_pct": uvxy_chg_val, "uvxy_volume": uvxy_v_val,
        })
        prev_close = cl

    return pd.DataFrame(rows), target_idx


def predict(payload: dict) -> dict:
    threshold = payload.get("_threshold", 0.6)
    model_dir_name = payload.get("_model_dir")

    model_dir = _find_model_dir(model_dir_name)
    model = joblib.load(model_dir / "model.joblib")
    scaler = joblib.load(model_dir / "scaler.joblib")

    with open(model_dir / "meta.json") as f:
        meta = json.load(f)

    features = meta["features"]
    is_mc = meta.get("is_multiclass", False)
    inv_label_map = meta.get("inv_label_map")

    df, target_idx = _build_dataframe(payload)
    df = add_features(df)

    target_row = df.iloc[[target_idx]]

    available = [c for c in features if c in target_row.columns]
    X = target_row[available].fillna(0).replace([np.inf, -np.inf], 0)
    X_scaled = pd.DataFrame(scaler.transform(X), columns=X.columns, index=X.index)

    proba = model.predict_proba(X_scaled)

    if is_mc and inv_label_map:
        pred_class = int(proba.argmax(axis=1)[0])
        orig_label = inv_label_map.get(str(pred_class), pred_class)
        prob = float(proba[0][pred_class])
    else:
        prob = float(proba[0][1]) if proba.shape[1] >= 2 else float(proba[0][0])
        orig_label = None

    tradeable = prob >= threshold

    # Session filter (inference-time only — model trains on all data)
    # Only allow signals during high-signal sessions: open (09:30-10:00) and power hour (14:30-16:00)
    allowed_sessions = payload.get("_allowed_sessions", ["open", "power"])
    minute_of_day = 0
    candle_times = payload.get("candle_times_et", [])
    if target_idx < len(candle_times):
        t_str = candle_times[target_idx]
        parts = t_str.split(":") if isinstance(t_str, str) else []
        if len(parts) >= 2:
            try:
                minute_of_day = int(parts[0]) * 60 + int(parts[1])
            except ValueError:
                pass

    in_open = 570 <= minute_of_day < 600        # 09:30 - 10:00
    in_power = 870 <= minute_of_day < 960        # 14:30 - 16:00
    session_ok = (
        "all" in allowed_sessions or
        ("open" in allowed_sessions and in_open) or
        ("power" in allowed_sessions and in_power) or
        ("morning" in allowed_sessions and 570 <= minute_of_day < 630) or
        ("midday" in allowed_sessions and 630 <= minute_of_day < 870)
    )

    if not session_ok:
        tradeable = False

    session_name = "open" if in_open else "power" if in_power else "midday" if 630 <= minute_of_day < 870 else "other"

    result = {
        "tradeable": tradeable,
        "prob": round(prob, 4),
        "threshold": threshold,
        "session": session_name,
        "session_ok": session_ok,
        "minute_of_day": minute_of_day,
        "close": float(df.iloc[target_idx]["close"]),
        "ema9": float(df.iloc[target_idx].get("ema9", 0)),
        "ema20": float(df.iloc[target_idx].get("ema20", 0)),
        "vwap": float(df.iloc[target_idx].get("vwap", 0)),
    }

    if is_mc:
        result["prediction"] = orig_label

    return result


def main():
    try:
        payload = json.loads(sys.stdin.read())
        result = predict(payload)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
