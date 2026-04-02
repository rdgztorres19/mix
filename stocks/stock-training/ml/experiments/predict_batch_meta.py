#!/usr/bin/env python3
"""
predict_batch_meta.py — Meta-labeling two-stage batch prediction.

Same stdin/stdout contract as predict_batch.py:
  stdin:  {"batch": [payload1, ...], "_threshold": 0.65}
  stdout: {"results": [{"tradeable": bool, "prob": float, "threshold": float}, ...]}

Stage 1 (primary model): high-recall LightGBM generates a probability.
Stage 2 (meta model):    trained only on primary's signals — filters which
                         signals are actually profitable.

The threshold applies to the meta-model output.
Primary model always runs at PRIMARY_THRESHOLD (from meta.json) to decide
which rows the meta-model sees; everything below that gets ignored.

Models loaded from: results/best_models/meta_labeling/
"""

import json
import sys
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.predict import build_dataframe, should_skip_prediction
from experiments.feature_engineer import add_features

# ── Paths ──────────────────────────────────────────────────────────────────────

META_MODELS_DIR = (
    Path(__file__).resolve().parent / "results" / "best_models" / "meta_labeling"
)


# ── Model loading ──────────────────────────────────────────────────────────────

def load_models():
    meta_path = META_MODELS_DIR / "meta.json"
    primary_path = META_MODELS_DIR / "primary_model.joblib"
    meta_model_path = META_MODELS_DIR / "meta_model.joblib"

    for p, name in [(meta_path, "meta.json"), (primary_path, "primary_model.joblib"),
                    (meta_model_path, "meta_model.joblib")]:
        if not p.exists():
            raise FileNotFoundError(f"{name} not found at {p}")

    with open(meta_path) as f:
        meta = json.load(f)

    primary_model = joblib.load(primary_path)
    meta_model = joblib.load(meta_model_path)

    return primary_model, meta_model, meta


# ── Feature extraction (same as predict_batch.py) ─────────────────────────────

def _extract_row(payload: dict, feature_cols: list):
    """
    Build dataframe from candle payload, add features, return the target row
    as a flat list aligned to feature_cols.
    Returns (row_list, skip_reason, details_dict).
    """
    if "candles" not in payload or len(payload.get("candles", [])) == 0:
        return None, "invalid payload", None

    target_idx = int(payload.get("target_idx", len(payload["candles"]) - 1))

    df = build_dataframe(payload)
    df = add_features(df)

    if "cumulative_volume_ratio" in df.columns and len(df) < 500:
        df["cumulative_volume_ratio"] = df["cumulative_volume_ratio"] * (len(df) / 539.0)

    if target_idx >= len(df):
        target_idx = len(df) - 1

    target_row = df.iloc[target_idx]

    details = {
        "close": round(float(target_row.get("close", 0)), 4) if pd.notna(target_row.get("close")) else None,
        "ema9":  round(float(target_row.get("ema9",  0)), 4) if pd.notna(target_row.get("ema9"))  else None,
        "ema20": round(float(target_row.get("ema20", 0)), 4) if pd.notna(target_row.get("ema20")) else None,
        "vwap":  round(float(target_row.get("vwap",  0)), 4) if pd.notna(target_row.get("vwap"))  else None,
    }

    should_skip, skip_reason = should_skip_prediction(target_row, payload)
    if should_skip:
        return None, skip_reason or "ignored by filter", details

    row = []
    for col in feature_cols:
        val = target_row.get(col, 0)
        row.append(float(val) if pd.notna(val) else 0.0)

    return row, None, details


# ── Batch inference ────────────────────────────────────────────────────────────

def run_batch(batch: list, threshold: float, primary_model, meta_model, meta: dict) -> list:
    feature_cols = meta["feature_columns"]
    primary_threshold = meta["primary_threshold"]  # e.g. 0.50
    meta_feature_names = meta["meta_features"]     # feature_cols + [primary_prob, primary_confidence]

    # ── Extract feature rows in parallel ──
    from concurrent.futures import ThreadPoolExecutor
    import os

    n_workers = min(len(batch), max(1, (os.cpu_count() or 4) - 1))

    if len(batch) <= 3:
        processed = [_extract_row(p, feature_cols) for p in batch]
    else:
        with ThreadPoolExecutor(max_workers=n_workers) as executor:
            processed = list(executor.map(lambda p: _extract_row(p, feature_cols), batch))

    rows, skip_reasons, ticket_details = zip(*processed) if processed else ([], [], [])
    rows = list(rows)
    skip_reasons = list(skip_reasons)
    ticket_details = list(ticket_details)

    valid_indices = [i for i, r in enumerate(rows) if r is not None]

    if not valid_indices:
        return [
            {
                "tradeable": False, "prob": 0.0, "threshold": threshold,
                "ignored": True, "ignore_reason": "no valid rows",
                **(ticket_details[i] or {}),
            }
            for i in range(len(batch))
        ]

    X = np.array([rows[i] for i in valid_indices])

    # ── Stage 1: primary model ──
    primary_proba = primary_model.predict_proba(X)[:, 1]

    # ── Stage 2: meta-model (only for rows where primary >= primary_threshold) ──
    # Build meta features: original features + primary_prob + primary_confidence
    primary_conf = np.abs(primary_proba - 0.5) * 2
    meta_X = np.hstack([X, primary_proba.reshape(-1, 1), primary_conf.reshape(-1, 1)])

    meta_proba = meta_model.predict_proba(meta_X)[:, 1]

    # Combine: tradeable only if primary passes its threshold AND meta passes the requested threshold
    tradeable_mask = (primary_proba >= primary_threshold) & (meta_proba >= threshold)

    # ── Map back to original batch order ──
    results = []
    valid_ix = 0

    for i in range(len(batch)):
        details = ticket_details[i] if i < len(ticket_details) else None
        extra = details if details else {}

        if rows[i] is None:
            results.append({
                "tradeable": False, "prob": 0.0, "threshold": threshold,
                "ignored": True,
                "ignore_reason": skip_reasons[i] or "invalid payload",
                **extra,
            })
        else:
            p_primary = float(primary_proba[valid_ix])
            p_meta = float(meta_proba[valid_ix])
            tradeable = bool(tradeable_mask[valid_ix])
            valid_ix += 1
            results.append({
                "tradeable": tradeable,
                "prob": round(p_meta, 4),          # meta prob is what the threshold applies to
                "primary_prob": round(p_primary, 4),
                "threshold": threshold,
                **extra,
            })

    return results


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    try:
        primary_model, meta_model, meta = load_models()
    except FileNotFoundError as e:
        print(json.dumps({"error": str(e), "results": []}))
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

    threshold = float(data.pop("_threshold", 0.60))
    results = run_batch(batch, threshold, primary_model, meta_model, meta)
    print(json.dumps({"results": results}))


if __name__ == "__main__":
    main()
