#!/usr/bin/env python3
"""
predict_batch_dual.py — Dual-model prediction pipeline.

Model 1 (vol_exp): "Is a big move coming?" → filters for volatility expansion
Model 2 (rr): "Is the direction favorable?" → filters for good reward/risk

Only returns tradeable=True when BOTH models agree.
Also returns ATR for dynamic TP/SL calculation.

Input:  {"batch": [...], "_threshold_vol": 0.80, "_threshold_rr": 0.60}
Output: {"results": [{"tradeable": bool, "prob_vol": float, "prob_rr": float, "atr": float, ...}, ...]}

Environment variables:
  DUAL_VOL_MODEL    — vol expansion model dir (default: XGBoost_V2_full_bin_vol_exp_10m_2atr)
  DUAL_RR_MODEL     — reward/risk model dir (default: XGBoost_V2_full_bin_rr10m_ge_2)
  DUAL_VOL_THRESHOLD — vol model threshold (default: 0.80)
  DUAL_RR_THRESHOLD  — rr model threshold (default: 0.60)
"""

import json
import os
import sys
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from predict import (
    build_dataframe,
    should_skip_prediction,
)

RESULTS_DIR = Path(__file__).resolve().parent / "results" / "best_models"

# ── Config ─────────────────────────────────────────────────────────────────

DUAL_VOL_MODEL = os.environ.get("DUAL_VOL_MODEL", "XGBoost_V2_full_bin_vol_exp_10m_2atr")
DUAL_RR_MODEL = os.environ.get("DUAL_RR_MODEL", "XGBoost_V2_full_bin_rr10m_ge_2")
DEFAULT_VOL_THRESHOLD = float(os.environ.get("DUAL_VOL_THRESHOLD", "0.80"))
DEFAULT_RR_THRESHOLD = float(os.environ.get("DUAL_RR_THRESHOLD", "0.60"))

# TP/SL as fixed % of price (0 = use ATR-based dynamic)
FIXED_TP_PCT = float(os.environ.get("DUAL_TP_PCT", "0"))  # e.g. 4.0 = 4% TP
FIXED_SL_PCT = float(os.environ.get("DUAL_SL_PCT", "0"))  # e.g. 2.0 = 2% SL
# ATR multipliers (used when FIXED_TP/SL are 0)
ATR_TP_MULT = float(os.environ.get("DUAL_ATR_TP_MULT", "2.0"))
ATR_SL_MULT = float(os.environ.get("DUAL_ATR_SL_MULT", "1.0"))

# Direction mode: how to determine long/short
#   "rr"        — use RR model (default, original behavior)
#   "vol_only"  — vol_exp only, direction from simple rules (no RR model)
#   "breakout"  — vol_exp + breakout rules (above VWAP + buy pressure = long)
DIRECTION_MODE = os.environ.get("DUAL_DIRECTION_MODE", "rr")


# ── Model Loading ──────────────────────────────────────────────────────────

def load_model(model_dir_name: str):
    """Load a model from best_models/{dir}/."""
    model_dir = RESULTS_DIR / model_dir_name
    meta_path = model_dir / "meta.json"
    model_path = model_dir / "model.joblib"
    scaler_path = model_dir / "scaler.joblib"

    if not meta_path.exists():
        raise FileNotFoundError(f"Meta not found: {meta_path}")
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    with open(meta_path) as f:
        meta = json.load(f)

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path) if scaler_path.exists() else None

    return model, scaler, meta


# ── Feature Extraction ─────────────────────────────────────────────────────

def extract_features(data: dict, feature_cols: list, add_features_fn):
    """Build dataframe, add features, extract feature row for the target candle."""
    if "candles" not in data or len(data.get("candles", [])) == 0:
        return None, "invalid payload", None

    target_idx = int(data.get("target_idx", len(data["candles"]) - 1))
    df = build_dataframe(data)
    df = add_features_fn(df)

    if "cumulative_volume_ratio" in df.columns and len(df) < 500:
        df["cumulative_volume_ratio"] = df["cumulative_volume_ratio"] * (len(df) / 539.0)

    if target_idx >= len(df):
        target_idx = len(df) - 1

    target_row = df.iloc[target_idx]

    should_skip, skip_reason = should_skip_prediction(target_row, data)
    if should_skip:
        return None, skip_reason or "ignored by filter", target_row

    return target_row, None, target_row


def row_to_array(target_row, feature_cols: list) -> list:
    """Extract feature values from a row for a specific model's feature set."""
    row = []
    for col in feature_cols:
        val = target_row.get(col, 0)
        row.append(float(val) if pd.notna(val) else 0.0)
    return row


# ── Batch Prediction ───────────────────────────────────────────────────────

def run_dual_batch(
    batch: list,
    vol_threshold: float,
    rr_threshold: float,
    vol_model, vol_scaler, vol_meta,
    rr_model, rr_scaler, rr_meta,
    add_features_fn,
):
    vol_feature_cols = vol_meta["feature_columns"]
    rr_feature_cols = rr_meta["feature_columns"]

    # All unique features needed by both models
    all_features = list(set(vol_feature_cols + rr_feature_cols))

    # Process payloads
    from concurrent.futures import ThreadPoolExecutor
    import os as _os

    def _process_one(data):
        target_row, skip_reason, raw_row = extract_features(data, all_features, add_features_fn)
        if target_row is None:
            return None, skip_reason, None
        return target_row, None, raw_row

    n_workers = min(len(batch), max(1, (_os.cpu_count() or 4) - 1))
    if len(batch) <= 3:
        processed = [_process_one(data) for data in batch]
    else:
        with ThreadPoolExecutor(max_workers=n_workers) as executor:
            processed = list(executor.map(_process_one, batch))

    # Separate valid vs skipped
    valid_indices = [i for i, (row, skip, _) in enumerate(processed) if row is not None]

    if not valid_indices:
        return [
            {
                "tradeable": False,
                "prob_vol": 0.0,
                "prob_rr": 0.0,
                "atr": 0.0,
                "threshold_vol": vol_threshold,
                "threshold_rr": rr_threshold,
                "ignored": True,
                "ignore_reason": processed[i][1] or "invalid",
            }
            for i in range(len(batch))
        ]

    # Build feature arrays for both models
    X_vol = np.array([row_to_array(processed[i][0], vol_feature_cols) for i in valid_indices])
    X_rr = np.array([row_to_array(processed[i][0], rr_feature_cols) for i in valid_indices])

    # Scale if needed
    use_vol_scaler = vol_meta.get("use_scaler", True)
    use_rr_scaler = rr_meta.get("use_scaler", True)

    if use_vol_scaler and vol_scaler is not None:
        X_vol = vol_scaler.transform(X_vol)
    if use_rr_scaler and rr_scaler is not None:
        X_rr = rr_scaler.transform(X_rr)

    # Predict with both models
    probas_vol = vol_model.predict_proba(X_vol)
    probas_rr = rr_model.predict_proba(X_rr)

    probs_vol = probas_vol[:, 1] if probas_vol.shape[1] > 1 else probas_vol[:, 0]
    probs_rr = probas_rr[:, 1] if probas_rr.shape[1] > 1 else probas_rr[:, 0]

    # Build results
    results = []
    valid_ix = 0

    for i in range(len(batch)):
        target_row, skip_reason, raw_row = processed[i]

        if target_row is None:
            results.append({
                "tradeable": False,
                "prob_vol": 0.0,
                "prob_rr": 0.0,
                "atr": 0.0,
                "threshold_vol": vol_threshold,
                "threshold_rr": rr_threshold,
                "ignored": True,
                "ignore_reason": skip_reason or "invalid",
            })
        else:
            pv = float(probs_vol[valid_ix])
            pr = float(probs_rr[valid_ix])
            valid_ix += 1

            # ATR from the payload or from the target row
            atr = float(target_row.get("atr", 0) if pd.notna(target_row.get("atr", 0)) else 0)
            close = float(target_row.get("close", 0) if pd.notna(target_row.get("close", 0)) else 0)

            # Vol expansion check
            vol_pass = pv >= vol_threshold

            # Direction rules
            dist_vwap = float(target_row.get("dist_vwap_pct", 0) if pd.notna(target_row.get("dist_vwap_pct", 0)) else 0)
            buy_vol_ratio = float(target_row.get("buy_volume_ratio", 0.5) if pd.notna(target_row.get("buy_volume_ratio", 0.5)) else 0.5)
            change_1m = float(target_row.get("change_1m", 0) if pd.notna(target_row.get("change_1m", 0)) else 0)
            break_hod = float(target_row.get("break_hod", 0) if pd.notna(target_row.get("break_hod", 0)) else 0)

            if DIRECTION_MODE == "vol_only":
                # Simple rules: above VWAP + buy pressure + last candle green
                above_vwap = dist_vwap > 0
                buying_pressure = buy_vol_ratio > 0.55
                last_green = change_1m > 0
                rr_pass = above_vwap and buying_pressure and last_green
                tradeable = vol_pass and rr_pass
            elif DIRECTION_MODE == "breakout":
                # Breakout: above VWAP + (buy pressure OR breaking HOD) + confirmation candle
                above_vwap = dist_vwap > 0
                has_momentum = buy_vol_ratio > 0.55 or break_hod > 0
                confirmation = change_1m > 0
                rr_pass = above_vwap and has_momentum and confirmation
                tradeable = vol_pass and rr_pass
            else:
                # Default "rr" mode — use RR model
                rr_pass = pr >= rr_threshold
                tradeable = vol_pass and rr_pass

            if FIXED_TP_PCT > 0:
                suggested_tp = FIXED_TP_PCT
            else:
                suggested_tp = round((atr * ATR_TP_MULT / max(close, 0.01)) * 100, 2) if close > 0 else 0

            if FIXED_SL_PCT > 0:
                suggested_sl = FIXED_SL_PCT
            else:
                suggested_sl = round((atr * ATR_SL_MULT / max(close, 0.01)) * 100, 2) if close > 0 else 0

            results.append({
                "tradeable": bool(tradeable),
                "prob": round(pr, 4),  # main.ts reads this for logging
                "prob_vol": round(pv, 4),
                "prob_rr": round(pr, 4),
                "threshold": rr_threshold,  # main.ts reads this
                "vol_pass": bool(vol_pass),
                "rr_pass": bool(rr_pass),
                "direction_mode": DIRECTION_MODE,
                "above_vwap": bool(dist_vwap > 0),
                "buy_vol_ratio": round(buy_vol_ratio, 3),
                "last_green": bool(change_1m > 0),
                "break_hod": bool(break_hod > 0),
                "atr": round(atr, 4),
                "close": round(close, 4),
                "threshold_vol": vol_threshold,
                "threshold_rr": rr_threshold,
                "suggested_tp_pct": suggested_tp,
                "suggested_sl_pct": suggested_sl,
            })

    return results


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    try:
        vol_model, vol_scaler, vol_meta = load_model(DUAL_VOL_MODEL)
        rr_model, rr_scaler, rr_meta = load_model(DUAL_RR_MODEL)
    except FileNotFoundError as e:
        print(json.dumps({"error": str(e), "results": []}))
        sys.exit(1)

    print(f"  [Dual] Vol model: {DUAL_VOL_MODEL} ({len(vol_meta['feature_columns'])} features) thr={DEFAULT_VOL_THRESHOLD}", file=sys.stderr)
    print(f"  [Dual] RR model:  {DUAL_RR_MODEL} ({len(rr_meta['feature_columns'])} features) thr={DEFAULT_RR_THRESHOLD}", file=sys.stderr)

    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": str(e), "results": []}))
        sys.exit(1)

    batch = data.get("batch", [])
    if not batch:
        print(json.dumps({"error": "batch is empty", "results": []}))
        sys.exit(1)

    vol_threshold = float(data.pop("_threshold_vol", DEFAULT_VOL_THRESHOLD))
    rr_threshold = float(data.pop("_threshold_rr", DEFAULT_RR_THRESHOLD))
    # Discard generic _threshold — dual model uses separate vol/rr thresholds from env vars
    data.pop("_threshold", None)

    from feature_engineer import add_features

    results = run_dual_batch(
        batch, vol_threshold, rr_threshold,
        vol_model, vol_scaler, vol_meta,
        rr_model, rr_scaler, rr_meta,
        add_features,
    )
    print(json.dumps({"results": results}))


if __name__ == "__main__":
    main()
