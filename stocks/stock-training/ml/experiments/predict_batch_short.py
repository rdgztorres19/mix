#!/usr/bin/env python3
"""
predict_batch_short.py — Short prediction using bearish models.

Loads a bearish model (e.g. bin_drop_4p0_30m) and predicts probability
that a stock will DROP. When prob >= threshold → tradeable (SHORT signal).

Same stdin/stdout contract as predict_batch.py.

Environment variables:
  PREDICT_MODEL        — model dir name (default: XGBoost_D_clean_bin_drop_4p0_30m)
  PREDICT_THRESHOLD    — default threshold (default: 0.70)
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
    DEFAULT_THRESHOLD,
    should_skip_prediction,
)

BEST_MODEL_DIR = Path(__file__).resolve().parent / "results" / "best_models"
_MODEL_NAME = os.environ.get("PREDICT_MODEL", "XGBoost_D_clean_bin_drop_4p0_30m")
_THRESHOLD = float(os.environ.get("PREDICT_THRESHOLD", "0.70"))


def run_batch(batch: list, threshold: float, model, scaler, meta, add_features_fn):
    feature_cols = meta["feature_columns"]

    def _process_one(data):
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

        details = {
            "close": round(float(target_row.get("close", 0)), 4) if pd.notna(target_row.get("close")) else None,
            "atr": round(float(target_row.get("atr", 0)), 4) if pd.notna(target_row.get("atr")) else None,
        }

        should_skip, skip_reason = should_skip_prediction(target_row, data)
        if should_skip:
            return None, skip_reason or "ignored by filter", details

        row = []
        for col in feature_cols:
            val = target_row.get(col, 0)
            row.append(float(val) if pd.notna(val) else 0.0)

        return row, None, details

    from concurrent.futures import ThreadPoolExecutor
    import os as _os

    n_workers = min(len(batch), max(1, (_os.cpu_count() or 4) - 1))
    if len(batch) <= 3:
        processed = [_process_one(data) for data in batch]
    else:
        with ThreadPoolExecutor(max_workers=n_workers) as executor:
            processed = list(executor.map(_process_one, batch))

    rows = []
    skip_reasons = []
    ticket_details = []
    for row, skip_reason, details in processed:
        rows.append(row)
        skip_reasons.append(skip_reason)
        ticket_details.append(details)

    valid_indices = [i for i, r in enumerate(rows) if r is not None]
    if not valid_indices:
        return [
            {
                "tradeable": False,
                "prob": 0.0,
                "threshold": threshold,
                "direction": "short",
                "ignored": True,
                "ignore_reason": "no valid rows",
                **(ticket_details[i] or {}),
            }
            for i in range(len(batch))
        ]

    X = np.array([rows[i] for i in valid_indices])
    use_scaler = meta.get("use_scaler", True)
    if use_scaler and scaler is not None:
        X = scaler.transform(X)

    probas = model.predict_proba(X)
    probs_arr = probas[:, 1] if probas.shape[1] > 1 else probas[:, 0]

    results = []
    valid_ix = 0

    for i in range(len(batch)):
        details = ticket_details[i] if i < len(ticket_details) else None
        extra = details if details else {}
        if rows[i] is None:
            reason = skip_reasons[i] or "invalid payload"
            results.append({
                "tradeable": False,
                "prob": 0.0,
                "threshold": threshold,
                "direction": "short",
                "ignored": True,
                "ignore_reason": reason,
                **extra,
            })
        else:
            prob = float(probs_arr[valid_ix])
            valid_ix += 1

            # Dynamic TP/SL for shorts based on ATR
            atr = float(extra.get("atr", 0) or 0)
            close = float(extra.get("close", 0) or 0)
            if close > 0 and atr > 0:
                suggested_tp_pct = round((atr * 2 / close) * 100, 2)
                suggested_sl_pct = round((atr * 1 / close) * 100, 2)
            else:
                suggested_tp_pct = 4.0
                suggested_sl_pct = 2.0

            results.append({
                "tradeable": bool(prob >= threshold),
                "prob": round(prob, 4),
                "threshold": threshold,
                "direction": "short",
                "suggested_tp_pct": suggested_tp_pct,
                "suggested_sl_pct": suggested_sl_pct,
                **extra,
            })

    return results


def main():
    model_dir = BEST_MODEL_DIR / _MODEL_NAME
    meta_path = model_dir / "meta.json"
    model_path = model_dir / "model.joblib"
    scaler_path = model_dir / "scaler.joblib"

    for p, name in [(meta_path, "meta.json"), (model_path, "model.joblib")]:
        if not p.exists():
            print(json.dumps({"error": f"{name} not found at {model_dir}", "results": []}))
            sys.exit(1)

    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": str(e), "results": []}))
        sys.exit(1)

    batch = data.get("batch", [])
    if not batch:
        print(json.dumps({"error": "batch is empty", "results": []}))
        sys.exit(1)

    threshold = float(data.pop("_threshold", _THRESHOLD))

    with open(meta_path) as f:
        meta = json.load(f)

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path) if scaler_path.exists() else None

    from feature_engineer import add_features

    results = run_batch(batch, threshold, model, scaler, meta, add_features)
    print(json.dumps({"results": results}))


if __name__ == "__main__":
    main()
