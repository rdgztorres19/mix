#!/usr/bin/env python3
"""
train_sequence.py — Train LSTM/GRU/Transformer for momentum prediction.

Usage:
  cd stock-training/ml
  python -m experiments.train_sequence
  python -m experiments.train_sequence --model transformer
  python -m experiments.train_sequence --walk-forward
  python -m experiments.train_sequence --csv data/training-v2-morning.csv
"""

import argparse
import gc
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from sklearn.metrics import roc_auc_score, precision_score, recall_score, f1_score

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.sequence_dataset import (
    MomentumSequenceDataset, SEQUENCE_FEATURES, create_temporal_datasets,
)
from experiments.models.lstm_momentum import LSTMMomentum, GRUMomentum, TransformerMomentum, LSTMWithAttention, CNNLSTMAttention
from experiments.feature_engineer import add_features
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.data_loader import load_base_df

# ── Config ────────────────────────────────────────────────────────────────────

RESULTS_DIR = Path(__file__).resolve().parent / "results"
SEQ_MODELS_DIR = RESULTS_DIR / "best_models" / "sequence"

DEFAULT_TARGET = "bin_tb30m_tp4p0_sl2p0"
DEFAULT_SEQ_LEN = 60
DEFAULT_HIDDEN = 64
DEFAULT_LAYERS = 2
DEFAULT_DROPOUT = 0.3
DEFAULT_LR = 0.001
DEFAULT_BATCH = 32
DEFAULT_EPOCHS = 50
DEFAULT_PATIENCE = 10


class FocalLoss(nn.Module):
    """Focal loss for class-imbalanced binary classification.
    Down-weights easy examples so training focuses on hard boundary cases."""
    def __init__(self, gamma: float = 2.0, pos_weight=None):
        super().__init__()
        self.gamma = gamma
        self.pos_weight = pos_weight

    def forward(self, logits, targets):
        bce = F.binary_cross_entropy_with_logits(
            logits, targets, pos_weight=self.pos_weight, reduction='none'
        )
        p_t = torch.sigmoid(logits) * targets + (1 - torch.sigmoid(logits)) * (1 - targets)
        focal_weight = (1 - p_t) ** self.gamma
        return (focal_weight * bce).mean()


def precision_at_threshold(y_true, y_proba, threshold):
    mask = y_proba >= threshold
    n = int(mask.sum())
    if n == 0:
        return 0.0, 0
    prec = float((mask & (y_true == 1)).sum()) / n
    return prec, n


# ── Data Loading ──────────────────────────────────────────────────────────────

def load_and_prepare(csv_path: str | None, target_name: str, max_rows: int = 0):
    """Load CSV, add features, compute targets, return prepared DataFrame."""
    print("Loading data...")
    t0 = time.time()

    if csv_path:
        csv = Path(csv_path)
        if not csv.is_absolute():
            csv = Path(__file__).resolve().parent.parent.parent / csv_path
        df = pd.read_csv(csv, low_memory=False)
        if max_rows and len(df) > max_rows:
            df = df.tail(max_rows).reset_index(drop=True)
            print(f"  Trimmed to last {max_rows} rows")
    else:
        from experiments.data_loader import CSV_PATH
        df = pd.read_csv(CSV_PATH, low_memory=False)
        if max_rows and len(df) > max_rows:
            df = df.tail(max_rows).reset_index(drop=True)
            print(f"  Trimmed to last {max_rows} rows")

    print(f"  Loaded {len(df)} rows in {time.time()-t0:.1f}s")

    # Add features
    print("  Adding features...")
    t0 = time.time()
    df = add_features(df)
    print(f"  Features done ({df.shape[1]} cols) in {time.time()-t0:.1f}s")

    # Compute targets
    print("  Computing targets...")
    t0 = time.time()
    targets = compute_target_variants(df)
    print(f"  {len(targets)} targets in {time.time()-t0:.1f}s")

    if target_name not in targets:
        print(f"  ERROR: target '{target_name}' not found")
        sys.exit(1)

    bundle = targets[target_name]
    y_full = np.asarray(bundle["y"])
    valid = np.asarray(bundle["valid"]).astype(bool)

    df = df.loc[valid].copy()
    df["_target"] = y_full[valid]

    # Filter valid_for_training if column exists
    if "valid_for_training" in df.columns:
        n_before = len(df)
        df = df[df["valid_for_training"] == 1].reset_index(drop=True)
        print(f"  Filtered valid: {n_before} → {len(df)}")

    print(f"  Final: {len(df)} rows, target balance: {(df['_target'] == 1).mean():.1%}")
    gc.collect()

    return df


# ── Training Loop ─────────────────────────────────────────────────────────────

def train_epoch(model, loader, optimizer, criterion, device):
    model.train()
    total_loss = 0
    n_batches = 0
    for X_batch, y_batch in loader:
        X_batch = X_batch.to(device)
        y_batch = y_batch.to(device)

        optimizer.zero_grad()
        output = model(X_batch)
        loss = criterion(output, y_batch)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
        optimizer.step()

        total_loss += loss.item()
        n_batches += 1

    return total_loss / max(n_batches, 1)


def evaluate(model, loader, device):
    model.eval()
    all_proba = []
    all_true = []

    with torch.no_grad():
        for X_batch, y_batch in loader:
            X_batch = X_batch.to(device)
            output = model(X_batch)
            proba = torch.sigmoid(output).cpu().numpy()
            all_proba.append(proba)
            all_true.append(y_batch.numpy())

    y_proba = np.concatenate(all_proba)
    y_true = np.concatenate(all_true)
    return y_true, y_proba


# ── Main Training ─────────────────────────────────────────────────────────────

def train_model(
    df: pd.DataFrame,
    model_type: str = "lstm",
    target_col: str = "_target",
    seq_len: int = DEFAULT_SEQ_LEN,
    epochs: int = DEFAULT_EPOCHS,
    patience: int = DEFAULT_PATIENCE,
    lr: float = DEFAULT_LR,
    batch_size: int = DEFAULT_BATCH,
    hidden_size: int = DEFAULT_HIDDEN,
    num_layers: int = DEFAULT_LAYERS,
    focal_loss: bool = False,
):
    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    print(f"\n  Device: {device}")

    # Create datasets
    print("\n  Creating sequence datasets...")
    train_ds, test_ds, dates_info = create_temporal_datasets(
        df, target_col, SEQUENCE_FEATURES, seq_len, train_frac=0.8, filter_valid=False,
    )
    scaler = dates_info.get("scaler")

    if len(train_ds) == 0 or len(test_ds) == 0:
        print("  ERROR: empty datasets")
        return None

    # Class balance
    train_labels = np.array([s[1] for s in train_ds.sequences])
    pos_weight = (train_labels == 0).sum() / max((train_labels == 1).sum(), 1)
    print(f"  Train: {len(train_ds)} seqs, pos={train_labels.mean():.1%}")
    print(f"  Test:  {len(test_ds)} seqs")
    print(f"  Pos weight: {pos_weight:.2f}")

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=4, persistent_workers=True)
    test_loader = DataLoader(test_ds, batch_size=batch_size, shuffle=False, num_workers=4, persistent_workers=True)

    # Create model
    n_features = train_ds.n_features
    if model_type == "lstm":
        model = LSTMMomentum(n_features, hidden_size, num_layers, DEFAULT_DROPOUT)
    elif model_type == "lstm_attention":
        model = LSTMWithAttention(n_features, hidden_size, num_layers, DEFAULT_DROPOUT)
    elif model_type == "cnn_lstm":
        model = CNNLSTMAttention(n_features, hidden_size, num_layers, DEFAULT_DROPOUT)
    elif model_type == "gru":
        model = GRUMomentum(n_features, hidden_size, num_layers, DEFAULT_DROPOUT)
    elif model_type == "transformer":
        model = TransformerMomentum(n_features, d_model=hidden_size, nhead=4,
                                     num_layers=num_layers, dropout=DEFAULT_DROPOUT)
    else:
        raise ValueError(f"Unknown model type: {model_type}")

    model = model.to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"\n  Model: {model_type.upper()}, {n_params:,} parameters")

    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=3, factor=0.5)
    pw = torch.tensor([pos_weight], dtype=torch.float32).to(device)
    if focal_loss:
        criterion = FocalLoss(gamma=2.0, pos_weight=pw)
        print(f"  Loss: FocalLoss(gamma=2.0, pos_weight={pos_weight:.2f})")
    else:
        criterion = nn.BCEWithLogitsLoss(pos_weight=pw)

    # Training loop
    best_auc = 0
    best_epoch = 0
    no_improve = 0

    print(f"\n  Training {epochs} epochs (patience={patience})...\n")

    for epoch in range(1, epochs + 1):
        t0 = time.time()
        train_loss = train_epoch(model, train_loader, optimizer, criterion, device)

        # Evaluate
        y_true, y_proba = evaluate(model, test_loader, device)
        try:
            auc = roc_auc_score(y_true, y_proba)
        except ValueError:
            auc = 0.5

        p60, n60 = precision_at_threshold(y_true, y_proba, 0.60)
        p70, n70 = precision_at_threshold(y_true, y_proba, 0.70)

        scheduler.step(1 - auc)  # minimize 1-AUC
        elapsed = time.time() - t0

        improved = "★" if auc > best_auc else " "
        print(f"  Epoch {epoch:3d}/{epochs} | loss={train_loss:.4f} | AUC={auc:.4f} | "
              f"P@.60={p60:.3f}({n60:>5d}) | P@.70={p70:.3f}({n70:>5d}) | "
              f"{elapsed:.1f}s {improved}")

        if auc > best_auc:
            best_auc = auc
            best_epoch = epoch
            no_improve = 0
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
        else:
            no_improve += 1
            if no_improve >= patience:
                print(f"\n  Early stopping at epoch {epoch} (best: {best_epoch}, AUC={best_auc:.4f})")
                break

    # Load best model
    model.load_state_dict(best_state)
    model.eval()

    # Final evaluation
    y_true, y_proba = evaluate(model, test_loader, device)
    try:
        auc = roc_auc_score(y_true, y_proba)
    except ValueError:
        auc = 0.5

    print(f"\n{'─' * 60}")
    print(f"  FINAL RESULTS — {model_type.upper()}")
    print(f"{'─' * 60}")
    print(f"  Best epoch: {best_epoch}")
    print(f"  AUC: {auc:.4f}")

    y_pred = (y_proba >= 0.5).astype(int)
    print(f"  Precision: {precision_score(y_true, y_pred, zero_division=0):.3f}")
    print(f"  Recall:    {recall_score(y_true, y_pred, zero_division=0):.3f}")
    print(f"  F1:        {f1_score(y_true, y_pred, zero_division=0):.3f}")

    print(f"\n  Precision @ threshold:")
    for thr in [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]:
        p, n = precision_at_threshold(y_true, y_proba, thr)
        print(f"    P >= {thr:.2f}: precision={p:.3f} ({n} signals)")

    return model, best_auc, y_true, y_proba, scaler


# ── Save ──────────────────────────────────────────────────────────────────────

def save_model(model, model_type, target_name, auc, seq_len, feature_cols, scaler=None, hidden_size=DEFAULT_HIDDEN, num_layers=DEFAULT_LAYERS):
    SEQ_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = SEQ_MODELS_DIR / f"{model_type}_{target_name}.pt"
    torch.save(model.state_dict(), model_path)

    if scaler is not None:
        mean, std = scaler
        np.save(SEQ_MODELS_DIR / f"{model_type}_{target_name}_scaler_mean.npy", mean)
        np.save(SEQ_MODELS_DIR / f"{model_type}_{target_name}_scaler_std.npy", std)

    meta = {
        "model_type": model_type,
        "target": target_name,
        "seq_len": seq_len,
        "n_features": len(feature_cols),
        "feature_cols": list(feature_cols),
        "auc": float(auc),
        "has_scaler": scaler is not None,
        "hidden_size": hidden_size,
        "num_layers": num_layers,
    }
    with open(SEQ_MODELS_DIR / f"{model_type}_{target_name}_meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\n  Model saved to {model_path}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="lstm", choices=["lstm", "lstm_attention", "cnn_lstm", "gru", "transformer"])
    parser.add_argument("--focal-loss", action="store_true", help="Use Focal Loss instead of BCEWithLogitsLoss")
    parser.add_argument("--target", default=DEFAULT_TARGET)
    parser.add_argument("--csv", default=None, help="Path to CSV (default: training-v2.csv)")
    parser.add_argument("--seq-len", type=int, default=DEFAULT_SEQ_LEN)
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH)
    parser.add_argument("--lr", type=float, default=DEFAULT_LR)
    parser.add_argument("--max-rows", type=int, default=2000000, help="Max rows to load (0=all)")
    parser.add_argument("--patience", type=int, default=DEFAULT_PATIENCE)
    parser.add_argument("--hidden-size", type=int, default=DEFAULT_HIDDEN)
    parser.add_argument("--num-layers", type=int, default=DEFAULT_LAYERS)
    parser.add_argument("--walk-forward", action="store_true")
    args = parser.parse_args()

    df = load_and_prepare(args.csv, args.target, args.max_rows)

    if args.walk_forward:
        print("\n  Walk-forward not yet implemented for sequence models")
        print("  Use single split for now")
        return

    result = train_model(
        df,
        model_type=args.model,
        seq_len=args.seq_len,
        epochs=args.epochs,
        patience=args.patience,
        batch_size=args.batch_size,
        lr=args.lr,
        hidden_size=args.hidden_size,
        num_layers=args.num_layers,
        focal_loss=args.focal_loss,
    )

    if result:
        model, auc, y_true, y_proba, scaler = result
        save_model(model, args.model, args.target, auc, args.seq_len, SEQUENCE_FEATURES,
                   scaler=scaler, hidden_size=args.hidden_size, num_layers=args.num_layers)


if __name__ == "__main__":
    main()
