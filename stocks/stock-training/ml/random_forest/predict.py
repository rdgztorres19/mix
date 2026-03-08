#!/usr/bin/env python3
"""
Predice si se puede operar (target=1) dado un objeto JSON con las features.
Lee JSON por stdin, escribe JSON por stdout.
Uso: echo '{"candle_idx":1,"open":10,...}' | python -m random_forest.predict
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import numpy as np

import config

DEFAULT_THRESHOLD = 0.6  # conservador: solo prob >= 60% = Operable (menos falsos positivos)


def main():
    model_path = Path(__file__).resolve().parent / "models" / "rf_model.joblib"
    if not model_path.exists():
        out = {"error": "Model not found", "tradeable": False}
        print(json.dumps(out))
        sys.exit(1)

    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        out = {"error": str(e), "tradeable": False}
        print(json.dumps(out))
        sys.exit(1)

    model = joblib.load(model_path)
    threshold = float(data.pop("_threshold", DEFAULT_THRESHOLD))

    row = []
    for col in config.FEATURE_COLUMNS:
        val = data.get(col)
        if val is None:
            val = 0
        try:
            row.append(float(val))
        except (TypeError, ValueError):
            row.append(0)

    X = np.array([row])
    proba = model.predict_proba(X)[0, 1]
    tradeable = proba >= threshold

    out = {
        "tradeable": bool(tradeable),
        "prob": round(float(proba), 4),
        "threshold": threshold,
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
