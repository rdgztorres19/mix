#!/usr/bin/env python3
"""
Batch screener prediction: scores stock profiles for the screener ML model.

Reads JSON from stdin:
  {"batch": [{"price": 5.2, "gap_pct": 12.3, ...}, ...]}

Writes JSON to stdout:
  {"results": [{"score": 0.82}, {"score": 0.34}, ...]}

Each profile must have the 22 features used by the screener model.
"""

import json
import sys
import warnings
from pathlib import Path

import joblib
import numpy as np

warnings.filterwarnings("ignore")

MODEL_DIR = Path(__file__).resolve().parent / "results" / "best_models" / "screener_lgbm"

FEATURES = [
    "price", "gap_pct", "premarket_volume", "shares_outstanding", "market_cap",
    "atr_pct", "volume_at_entry", "dist_hod_pct", "time_of_first_entry_min",
    "in_gapper", "in_gainer_session", "in_gainer_intraday", "in_high_session", "in_high_current",
    "rank_gapper", "rank_gainer_session", "rank_gainer_intraday", "rank_high_session", "rank_high_current",
    "num_ranking_types", "max_metric_value", "combined_rank",
]


def main():
    model_path = MODEL_DIR / "model.joblib"
    scaler_path = MODEL_DIR / "scaler.joblib"

    if not model_path.exists():
        print(json.dumps({"error": "screener model not found", "results": []}))
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

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path) if scaler_path.exists() else None

    # Build feature matrix
    X = np.zeros((len(batch), len(FEATURES)))
    for i, profile in enumerate(batch):
        for j, feat in enumerate(FEATURES):
            val = profile.get(feat, 0)
            X[i, j] = float(val) if val is not None else 0.0

    X = np.nan_to_num(X, nan=0, posinf=0, neginf=0)

    if scaler is not None:
        X = scaler.transform(X)

    probas = model.predict_proba(X)
    scores = probas[:, 1] if probas.shape[1] > 1 else probas[:, 0]

    results = [{"score": round(float(s), 4)} for s in scores]
    print(json.dumps({"results": results}))


if __name__ == "__main__":
    main()
