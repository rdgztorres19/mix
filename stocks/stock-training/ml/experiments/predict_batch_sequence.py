#!/usr/bin/env python3
"""
predict_batch_sequence.py — LSTM sequence model batch prediction.

Same stdin/stdout contract as predict_batch.py:
  stdin:  {"batch": [payload1, ...], "_threshold": 0.75}
  stdout: {"results": [{"tradeable": bool, "prob": float, "threshold": float}, ...]}

Each payload must have candles[] with >= seq_len entries.
Model and weights are loaded once per process invocation.

Config via env vars:
  LSTM_TARGET       — model target name (default: bin_rr10m_ge_2)
  SEQ_LEN           — sequence length (default: 30)
  PREDICT_THRESHOLD — default threshold if not in payload (default: 0.70)
"""

import json
import os
import sys
import warnings
from pathlib import Path

import numpy as np
import torch

warnings.filterwarnings("ignore")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.models.lstm_momentum import LSTMMomentum, LSTMWithAttention, CNNLSTMAttention
from experiments.sequence_dataset import SEQUENCE_FEATURES
from experiments.feature_engineer import add_features
from experiments.predict import build_dataframe

# ── Config ─────────────────────────────────────────────────────────────────────

SEQ_MODELS_DIR = Path(__file__).resolve().parent / "results" / "best_models" / "sequence"

_TARGET = os.environ.get("LSTM_TARGET", "bin_tb30m_tp4p0_sl2p0")
_MODEL_TYPE = os.environ.get("LSTM_MODEL_TYPE", "lstm")
_SEQ_LEN = int(os.environ.get("SEQ_LEN", "30"))
_DEFAULT_THRESHOLD = float(os.environ.get("PREDICT_THRESHOLD", "0.70"))


# ── Model loading ──────────────────────────────────────────────────────────────

def load_model(target: str, model_type: str = "lstm"):
    meta_path = SEQ_MODELS_DIR / f"{model_type}_{target}_meta.json"
    model_path = SEQ_MODELS_DIR / f"{model_type}_{target}.pt"

    if not meta_path.exists():
        raise FileNotFoundError(f"Meta not found: {meta_path}")
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found: {model_path}")

    with open(meta_path) as f:
        meta = json.load(f)

    n_features = meta["n_features"]
    hidden_size = meta.get("hidden_size", 64)
    num_layers = meta.get("num_layers", 2)
    model_type = meta.get("model_type", "lstm")

    if model_type == "lstm_attention":
        model = LSTMWithAttention(n_features=n_features, hidden_size=hidden_size, num_layers=num_layers, dropout=0.3)
    elif model_type == "cnn_lstm":
        model = CNNLSTMAttention(n_features=n_features, hidden_size=hidden_size, num_layers=num_layers, dropout=0.3)
    elif model_type == "gru":
        from experiments.models.lstm_momentum import GRUMomentum
        model = GRUMomentum(n_features=n_features, hidden_size=hidden_size, num_layers=num_layers, dropout=0.3)
    elif model_type == "transformer":
        from experiments.models.lstm_momentum import TransformerMomentum
        model = TransformerMomentum(n_features=n_features, d_model=hidden_size, num_layers=num_layers, dropout=0.3)
    else:
        model = LSTMMomentum(n_features=n_features, hidden_size=hidden_size, num_layers=num_layers, dropout=0.3)
    model.load_state_dict(
        torch.load(model_path, map_location="cpu", weights_only=True)
    )
    model.eval()

    # Load global scaler if saved alongside the model
    mean_path = SEQ_MODELS_DIR / f"{model_type}_{target}_scaler_mean.npy"
    std_path = SEQ_MODELS_DIR / f"{model_type}_{target}_scaler_std.npy"
    scaler = None
    if mean_path.exists() and std_path.exists():
        scaler = (np.load(mean_path), np.load(std_path))

    return model, meta, scaler


# ── Sequence building ──────────────────────────────────────────────────────────

def _build_sequence(payload: dict, feature_cols: list, seq_len: int, scaler=None):
    """
    Build a (seq_len, n_features) float32 array from a predict payload.
    Returns (array, None) on success, (None, reason_str) on failure.
    """
    candles = payload.get("candles", [])
    if len(candles) < seq_len:
        return None, f"need >= {seq_len} candles, got {len(candles)}"

    try:
        df = build_dataframe(payload)
        df = add_features(df)
    except Exception as e:
        return None, f"feature error: {e}"

    if len(df) < seq_len:
        return None, f"only {len(df)} rows after features, need {seq_len}"

    tail = df.tail(seq_len)

    # Build feature matrix — zero-fill any missing columns
    feat_matrix = np.zeros((seq_len, len(feature_cols)), dtype=np.float32)
    for j, col in enumerate(feature_cols):
        if col in tail.columns:
            feat_matrix[:, j] = tail[col].values.astype(np.float32)

    feat_matrix = np.nan_to_num(feat_matrix, nan=0.0, posinf=0.0, neginf=0.0)

    # Apply global scaler fitted on training data (consistent with training)
    if scaler is not None:
        mean, std = scaler
        feat_matrix = (feat_matrix - mean) / std

    return feat_matrix, None


# ── Batch inference ────────────────────────────────────────────────────────────

def run_batch(batch: list, threshold: float, model, feature_cols: list, seq_len: int, scaler=None) -> list:
    sequences = []
    skip_reasons = []

    for payload in batch:
        seq, reason = _build_sequence(payload, feature_cols, seq_len, scaler=scaler)
        sequences.append(seq)
        skip_reasons.append(reason)

    valid_indices = [i for i, s in enumerate(sequences) if s is not None]

    if not valid_indices:
        return [
            {
                "tradeable": False,
                "prob": 0.0,
                "threshold": threshold,
                "ignored": True,
                "ignore_reason": skip_reasons[i] or "invalid payload",
            }
            for i in range(len(batch))
        ]

    X = np.stack([sequences[i] for i in valid_indices])  # (n_valid, seq_len, n_features)
    X_tensor = torch.from_numpy(X)

    with torch.no_grad():
        logits = model(X_tensor)
        probs = torch.sigmoid(logits).numpy()

    results = []
    valid_ix = 0

    for i in range(len(batch)):
        if sequences[i] is None:
            results.append(
                {
                    "tradeable": False,
                    "prob": 0.0,
                    "threshold": threshold,
                    "ignored": True,
                    "ignore_reason": skip_reasons[i] or "invalid payload",
                }
            )
        else:
            prob = float(probs[valid_ix])
            valid_ix += 1
            results.append(
                {
                    "tradeable": bool(prob >= threshold),
                    "prob": round(prob, 4),
                    "threshold": threshold,
                }
            )

    return results


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    target = _TARGET
    seq_len = _SEQ_LEN

    try:
        model, meta, scaler = load_model(target, model_type=_MODEL_TYPE)
    except FileNotFoundError as e:
        print(json.dumps({"error": str(e), "results": []}))
        sys.exit(1)

    seq_len = meta.get("seq_len", seq_len)   # use trained seq_len, fallback to env var
    feature_cols = meta["feature_cols"]

    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(json.dumps({"error": str(e), "results": []}))
        sys.exit(1)

    batch = data.get("batch", [])
    if not batch:
        print(json.dumps({"error": "batch is empty", "results": []}))
        sys.exit(1)

    threshold = float(data.pop("_threshold", _DEFAULT_THRESHOLD))
    results = run_batch(batch, threshold, model, feature_cols, seq_len, scaler=scaler)
    print(json.dumps({"results": results}))


if __name__ == "__main__":
    main()
