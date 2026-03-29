#!/usr/bin/env python3
"""
Batch predict: one process, one model load, N predictions.
Reads JSON from stdin: {"batch": [payload1, payload2, ...], "_threshold": 0.7}
Writes JSON to stdout: {"results": [result1, result2, ...]}

Each payload has the same format as predict.py (candles + metadata).
Used by debug-predict-csv.js for fast backtesting.
"""

import json
import sys
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# Import shared helpers from predict.py
sys.path.insert(0, str(Path(__file__).resolve().parent))
from predict import (
    build_dataframe,
    DEFAULT_THRESHOLD,
    BEST_MODEL_DIR,
    should_skip_prediction,
)


def run_batch(batch: list, threshold: float, model, scaler, meta, add_features_fn):
    feature_cols = meta["feature_columns"]
    is_multiclass = meta.get("is_multiclass", False)
    inv_label_map = meta.get("inv_label_map", {})

    rows = []
    skip_reasons = []
    ticket_details = []

    def _extract_details(tr):
        return {
            "close": round(float(tr.get("close", 0)), 4) if pd.notna(tr.get("close")) else None,
            "ema9": round(float(tr.get("ema9", 0)), 4) if pd.notna(tr.get("ema9")) else None,
            "ema20": round(float(tr.get("ema20", 0)), 4) if pd.notna(tr.get("ema20")) else None,
            "vwap": round(float(tr.get("vwap", 0)), 4) if pd.notna(tr.get("vwap")) else None,
        }

    _payload_dump_done = False

    for data in batch:
        if "candles" not in data or len(data.get("candles", [])) == 0:
            rows.append(None)
            skip_reasons.append("invalid payload")
            ticket_details.append(None)
            continue

        target_idx = int(data.get("target_idx", len(data["candles"]) - 1))
        df = build_dataframe(data)
        df = add_features_fn(df)

        # DEBUG: dump first payload + computed features to compare with eval_multiday
        import os
        debug_dir = os.path.join(os.path.dirname(__file__), "results")
        payload_path = os.path.join(debug_dir, "_debug_payload.json")
        features_path = os.path.join(debug_dir, "_debug_features_b.json")
        if not _payload_dump_done and not os.path.exists(payload_path):
            _payload_dump_done = True
            import json as _json
            # Save raw payload (without full candle array to keep file small)
            payload_meta = {k: v for k, v in data.items() if k != "candles"}
            payload_meta["_n_candles"] = len(data.get("candles", []))
            payload_meta["_first_candle"] = data["candles"][0] if data.get("candles") else None
            payload_meta["_last_candle"] = data["candles"][-1] if data.get("candles") else None
            with open(payload_path, "w") as _f:
                _json.dump(payload_meta, _f, indent=2, default=str)
            # Save computed features for target row
            if target_idx < len(df):
                tr = df.iloc[target_idx]
                feat_data = {}
                for col in feature_cols:
                    val = tr.get(col, 0)
                    feat_data[col] = round(float(val), 8) if pd.notna(val) else 0.0
                feat_data["_prob"] = "pending"
                feat_data["_candle_time"] = str(tr.get("candle_time_et", "?"))
                feat_data["_n_candles"] = len(df)
                with open(features_path, "w") as _f:
                    _json.dump(feat_data, _f, indent=2)

        # Fix cumulative_volume_ratio for partial day prediction
        if "cumulative_volume_ratio" in df.columns and len(df) < 500:
            df["cumulative_volume_ratio"] = (
                df["cumulative_volume_ratio"] * (len(df) / 539.0)
            )

        if target_idx >= len(df):
            target_idx = len(df) - 1

        target_row = df.iloc[target_idx]
        details = _extract_details(target_row)

        # ---------------------------------------------------------
        # PRE-PREDICTION FILTER
        #
        # Examples of when a row may be ignored:
        # - price below EMA9
        # - price below VWAP
        # - low volume / bad ATR / bad time window
        # - any other hard filter defined in should_skip_prediction()
        # ---------------------------------------------------------
        should_skip, skip_reason = should_skip_prediction(target_row, data)
        if should_skip:
            rows.append(None)
            skip_reasons.append(skip_reason or "ignored by filter")
            ticket_details.append(details)
            continue

        row = []
        for col in feature_cols:
            val = target_row.get(col, 0)
            row.append(float(val) if pd.notna(val) else 0.0)

        # DEBUG: dump first valid prediction's features to file
        import os
        debug_path = os.path.join(os.path.dirname(__file__), "results", "_debug_features.json")
        if not os.path.exists(debug_path) and row is not None:
            debug_data = {col: round(float(row[j]), 8) for j, col in enumerate(feature_cols)}
            debug_data["_symbol"] = data.get("_symbol", "?")
            debug_data["_n_candles"] = len(data.get("candles", []))
            debug_data["_target_idx"] = target_idx
            debug_data["_candle_time"] = str(target_row.get("candle_time_et", "?"))
            with open(debug_path, "w") as _f:
                import json as _json
                _json.dump(debug_data, _f, indent=2)

        rows.append(row)
        skip_reasons.append(None)
        ticket_details.append(details)

    # Build X, handling skipped/invalid rows
    valid_indices = [i for i, r in enumerate(rows) if r is not None]
    if not valid_indices:
        return [
            {
                "tradeable": False,
                "prob": 0.0,
                "threshold": threshold,
                "ignored": True,
                "ignore_reason": "no valid rows",
                **(ticket_details[i] or {}),
            }
            for i in range(len(batch))
        ]

    X = np.array([rows[i] for i in valid_indices])
    use_scaler = meta.get("use_scaler", True)  # V2 models set this to False
    if use_scaler and scaler is not None:
        X = scaler.transform(X)

    probas = model.predict_proba(X)

    if is_multiclass:
        long_idx = None
        for idx_str, orig_label in inv_label_map.items():
            if int(orig_label) == 1:
                long_idx = int(idx_str)
                break
        if long_idx is None:
            long_idx = len(probas[0]) - 1
        probs_arr = probas[:, long_idx]
    else:
        probs_arr = probas[:, 1] if probas.shape[1] > 1 else probas[:, 0]

    # Map back to original order
    results = []
    valid_ix = 0

    for i in range(len(batch)):
        details = ticket_details[i] if i < len(ticket_details) else None
        extra = details if details else {}
        if rows[i] is None:
            reason = skip_reasons[i] or "invalid payload"
            results.append(
                {
                    "tradeable": False,
                    "prob": 0.0,
                    "threshold": threshold,
                    "ignored": True,
                    "ignore_reason": reason,
                    **extra,
                }
            )
        else:
            prob = float(probs_arr[valid_ix])
            valid_ix += 1
            results.append(
                {
                    "tradeable": bool(prob >= threshold),
                    "prob": round(prob, 4),
                    "threshold": threshold,
                    **extra,
                }
            )

    return results


def main():
    meta_path = BEST_MODEL_DIR / "meta.json"
    model_path = BEST_MODEL_DIR / "model.joblib"
    scaler_path = BEST_MODEL_DIR / "scaler.joblib"

    for p, name in [(meta_path, "meta.json"), (model_path, "model.joblib")]:
        if not p.exists():
            print(json.dumps({"error": f"{name} not found", "results": []}))
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

    threshold = float(data.pop("_threshold", DEFAULT_THRESHOLD))

    with open(meta_path) as f:
        meta = json.load(f)

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path) if scaler_path.exists() else None

    from feature_engineer import add_features

    results = run_batch(batch, threshold, model, scaler, meta, add_features)
    print(json.dumps({"results": results}))


if __name__ == "__main__":
    main()