#!/usr/bin/env python3
"""
predict_ensemble.py — Ensemble prediction para SPY day trading.
Carga N modelos, requiere consenso para generar señal.

Modos de ensemble:
  - "unanimous": TODOS los modelos deben estar por encima del threshold
  - "majority": >50% de los modelos deben estar por encima del threshold
  - "average": Promedio de probabilidades debe estar por encima del threshold

Usage (stdin JSON → stdout JSON):
  echo '{"candles": [...], ...}' | python -m ml.predict_ensemble

Config via _ensemble en el payload:
{
  "candles": [...],
  "uvxy_candles": [...],
  "_ensemble": {
    "model_dirs": [
      "XGBoost_G_spy_optimized_bin_rr10m_ge_2",
      "XGBoost_G_spy_optimized_bin_rr30m_ge_2",
      "LightGBM_B_enriched_vs_tb10m_10_07"
    ],
    "mode": "unanimous",
    "threshold": 0.7
  }
}

Output:
{
  "tradeable": true,
  "ensemble_mode": "unanimous",
  "n_models": 3,
  "n_agree": 3,
  "avg_prob": 0.78,
  "min_prob": 0.72,
  "max_prob": 0.85,
  "individual": [
    {"model_dir": "...", "prob": 0.72, "above_threshold": true},
    ...
  ],
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
from ml.predict import _build_dataframe

BEST_MODELS_DIR = Path(__file__).resolve().parent / "results" / "best_models"


def _load_all_model_dirs() -> list[Path]:
    """Find all trained model directories."""
    if not BEST_MODELS_DIR.exists():
        return []
    return [d for d in BEST_MODELS_DIR.iterdir()
            if d.is_dir() and (d / "model.joblib").exists()]


def _predict_single(model_dir: Path, df: pd.DataFrame, target_idx: int) -> dict:
    """Run prediction with a single model. Returns prob and metadata."""
    model = joblib.load(model_dir / "model.joblib")
    scaler = joblib.load(model_dir / "scaler.joblib")

    with open(model_dir / "meta.json") as f:
        meta = json.load(f)

    features = meta["features"]
    is_mc = meta.get("is_multiclass", False)

    target_row = df.iloc[[target_idx]]
    available = [c for c in features if c in target_row.columns]
    X = target_row[available].fillna(0).replace([np.inf, -np.inf], 0)
    X_scaled = pd.DataFrame(scaler.transform(X), columns=X.columns, index=X.index)

    proba = model.predict_proba(X_scaled)

    if is_mc:
        prob = float(proba[0].max())
    else:
        prob = float(proba[0][1]) if proba.shape[1] >= 2 else float(proba[0][0])

    return {
        "model_dir": model_dir.name,
        "model": meta.get("model", ""),
        "target": meta.get("target", ""),
        "feature_set": meta.get("feature_set", ""),
        "session": meta.get("session", "all"),
        "prob": round(prob, 4),
    }


def predict_ensemble(payload: dict) -> dict:
    ensemble_cfg = payload.get("_ensemble", {})
    mode = ensemble_cfg.get("mode", "unanimous")
    threshold = ensemble_cfg.get("threshold", 0.7)
    model_dir_names = ensemble_cfg.get("model_dirs", None)

    # Find model dirs
    if model_dir_names:
        model_dirs = []
        for name in model_dir_names:
            d = BEST_MODELS_DIR / name
            if d.exists() and (d / "model.joblib").exists():
                model_dirs.append(d)
            else:
                print(f"  Warning: model dir not found: {name}", file=sys.stderr)
    else:
        model_dirs = _load_all_model_dirs()

    if not model_dirs:
        return {"error": "No trained models found", "tradeable": False}

    # Build dataframe once
    df, target_idx = _build_dataframe(payload)
    df = add_features(df)

    # Run each model
    individual = []
    for model_dir in model_dirs:
        try:
            result = _predict_single(model_dir, df, target_idx)
            result["above_threshold"] = result["prob"] >= threshold
            individual.append(result)
        except Exception as e:
            individual.append({
                "model_dir": model_dir.name,
                "prob": 0.0,
                "above_threshold": False,
                "error": str(e),
            })

    # Ensemble logic
    probs = [r["prob"] for r in individual if "error" not in r]
    n_above = sum(1 for r in individual if r.get("above_threshold", False))
    n_models = len(individual)

    if mode == "unanimous":
        tradeable = n_above == n_models and n_models > 0
    elif mode == "majority":
        tradeable = n_above > n_models / 2
    elif mode == "average":
        avg = np.mean(probs) if probs else 0
        tradeable = avg >= threshold
    else:
        tradeable = n_above == n_models  # default to unanimous

    avg_prob = float(np.mean(probs)) if probs else 0.0
    min_prob = float(np.min(probs)) if probs else 0.0
    max_prob = float(np.max(probs)) if probs else 0.0

    # Session filter (inference-time — only trade during high-signal sessions)
    allowed_sessions = ensemble_cfg.get("allowed_sessions", ["open", "power"])
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

    in_open = 570 <= minute_of_day < 600
    in_power = 870 <= minute_of_day < 960
    session_ok = (
        "all" in allowed_sessions or
        ("open" in allowed_sessions and in_open) or
        ("power" in allowed_sessions and in_power)
    )

    if not session_ok:
        tradeable = False

    session_name = "open" if in_open else "power" if in_power else "midday" if 630 <= minute_of_day < 870 else "other"

    return {
        "tradeable": bool(tradeable),
        "ensemble_mode": mode,
        "threshold": threshold,
        "session": session_name,
        "session_ok": session_ok,
        "n_models": n_models,
        "n_agree": n_above,
        "avg_prob": round(avg_prob, 4),
        "min_prob": round(min_prob, 4),
        "max_prob": round(max_prob, 4),
        "individual": individual,
        "close": float(df.iloc[target_idx]["close"]),
        "ema9": float(df.iloc[target_idx].get("ema9", 0)),
        "ema20": float(df.iloc[target_idx].get("ema20", 0)),
        "vwap": float(df.iloc[target_idx].get("vwap", 0)),
    }


def main():
    try:
        payload = json.loads(sys.stdin.read())
        result = predict_ensemble(payload)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
