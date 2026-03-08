#!/usr/bin/env python3
"""
Predice clase multiclase (-1/0/1) dado un objeto JSON con las features.
Lee JSON por stdin, escribe JSON por stdout.
Aplica scaler (z-score) antes de predecir.
Uso: echo '{"candle_idx":1,"open":10,...}' | python -m xgb.predict
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import numpy as np

import config


def main():
    model_path = Path(__file__).resolve().parent / "models" / "xgb_model.joblib"
    scaler_path = Path(__file__).resolve().parent / "models" / "xgb_scaler.joblib"

    if not model_path.exists():
        out = {"error": "Model not found. Run: python -m xgb.train", "predicted_class": None}
        print(json.dumps(out))
        sys.exit(1)

    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        out = {"error": str(e), "predicted_class": None}
        print(json.dumps(out))
        sys.exit(1)

    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path) if scaler_path.exists() else None

    feature_cols = config.FEATURE_COLUMNS
    meta_path = Path(__file__).resolve().parent / "models" / "xgb_meta.json"
    if meta_path.exists():
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            feature_cols = meta.get("feature_columns", feature_cols)
        except Exception:
            pass

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

    pred_class = int(model.predict(X)[0])
    proba = model.predict_proba(X)[0]
    classes = model.classes_
    proba_dict = {int(c): round(float(p), 4) for c, p in zip(classes, proba)}
    proba_bullish = float(proba_dict.get(1, 0))
    threshold = getattr(config, "BULLISH_PROBA_THRESHOLD", 0.7)
    tradeable = proba_bullish > threshold

    out = {
        "predicted_class": pred_class,
        "proba": proba_dict,
        "proba_bullish": round(proba_bullish, 4),
        "tradeable": tradeable,
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
