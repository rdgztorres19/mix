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

    def _extract_details(tr):
        return {
            "close": round(float(tr.get("close", 0)), 4) if pd.notna(tr.get("close")) else None,
            "ema9": round(float(tr.get("ema9", 0)), 4) if pd.notna(tr.get("ema9")) else None,
            "ema20": round(float(tr.get("ema20", 0)), 4) if pd.notna(tr.get("ema20")) else None,
            "vwap": round(float(tr.get("vwap", 0)), 4) if pd.notna(tr.get("vwap")) else None,
        }

    # ── Process each payload (parallelized) ───────────────────────────

    def _process_one(data):
        """Process a single payload: build_dataframe + add_features + extract row."""
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
        details = _extract_details(target_row)

        should_skip, skip_reason = should_skip_prediction(target_row, data)
        if should_skip:
            return None, skip_reason or "ignored by filter", details

        row = []
        for col in feature_cols:
            val = target_row.get(col, 0)
            row.append(float(val) if pd.notna(val) else 0.0)

        return row, None, details

    # Run in parallel using threads (numpy/pandas release GIL for heavy ops)
    from concurrent.futures import ThreadPoolExecutor
    import os

    n_workers = min(len(batch), max(1, (os.cpu_count() or 4) - 1))

    if len(batch) <= 3:
        # Small batch: sequential is faster (no thread overhead)
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