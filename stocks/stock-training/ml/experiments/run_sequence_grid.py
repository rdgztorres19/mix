#!/usr/bin/env python3
"""
run_sequence_grid.py — Grid search for LSTM/CNN-LSTM sequence models.

Tests multiple feature sets × targets × model architectures.
Results logged to results/sequence_grid_results.csv.

Usage:
  cd stock-training/ml
  python -m experiments.run_sequence_grid --csv data/training-v2-morning-full.csv
  python -m experiments.run_sequence_grid --csv data/training-v2-morning-full.csv --quick
  python -m experiments.run_sequence_grid --csv data/training-v2-morning-full.csv --models cnn_lstm lstm_attention
"""

import argparse
import csv
import gc
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.sequence_dataset import (
    MomentumSequenceDataset, SEQUENCE_FEATURES, create_temporal_datasets,
    compute_scaler, apply_scaler,
)
from experiments.models.lstm_momentum import (
    LSTMMomentum, GRUMomentum, TransformerMomentum, LSTMWithAttention, CNNLSTMAttention,
)
from experiments.feature_engineer import add_features
from experiments.target_variants import compute_target_variants
from experiments.train_sequence import (
    train_epoch, evaluate, precision_at_threshold, load_and_prepare,
)

# ── Config ────────────────────────────────────────────────────────────────────

RESULTS_DIR = Path(__file__).resolve().parent / "results"
GRID_CSV = RESULTS_DIR / "sequence_grid_results.csv"

DEFAULT_EPOCHS = 30      # shorter per combo (grid explores, not perfects)
DEFAULT_PATIENCE = 7
DEFAULT_BATCH = 128      # faster for grid
DEFAULT_LR = 0.001
DEFAULT_HIDDEN = 64
DEFAULT_LAYERS = 2
DEFAULT_DROPOUT = 0.3
DEFAULT_SEQ_LEN = 60

# ── Feature Sets ──────────────────────────────────────────────────────────────

FEATURE_SETS = {
    # Full 30 features (current default)
    "full_30": SEQUENCE_FEATURES,

    # Lean 12 — only features with unique information (less correlated)
    "lean_12": [
        "rsi", "bollinger_pct_b", "volume_rel", "atr_rel",
        "dist_vwap_pct", "dist_hod_pct", "change_5m",
        "minute_of_day", "gap_vs_atr", "bar_range_vs_atr",
        "float_rotation", "buy_volume_ratio",
    ],

    # Momentum core — price action + momentum only
    "momentum_15": [
        "change_1m", "change_5m", "roc_5", "roc_10",
        "return_lag_1", "return_lag_2",
        "rsi", "bollinger_pct_b", "stochastic_k",
        "bar_range_vs_atr", "close_position",
        "dist_vwap_pct", "dist_hod_pct",
        "volume_rel", "minute_of_day",
    ],

    # Volume + volatility focused
    "vol_volume_12": [
        "volume_rel", "buy_volume_ratio", "float_rotation",
        "atr_rel", "volatility_15m", "bar_range_vs_atr",
        "dist_vwap_pct", "dist_hod_pct",
        "rsi", "gap_vs_atr",
        "minute_of_day", "time_since_open_min",
    ],

    # Structure — distances + breakout signals
    "structure_14": [
        "dist_vwap_pct", "dist_hod_pct", "dist_lod_pct",
        "dist_ema9", "dist_ema20",
        "close_position", "bar_range_vs_atr",
        "is_green", "body_pct",
        "volume_rel", "rsi",
        "minute_of_day", "gap_vs_atr", "time_since_open_min",
    ],

    # Oscillators — mean-reversion signals
    "oscillators_10": [
        "rsi", "stochastic_k", "cci", "williams_r", "bollinger_pct_b",
        "dist_vwap_pct", "volume_rel",
        "atr_rel", "minute_of_day", "change_5m",
    ],

    # RAW — minimal per-candle data, let LSTM learn its own patterns
    # No pre-computed indicators (no RSI, no ROC, no bollinger)
    # Just: how did price move? how much volume? where in the range? where vs key levels?
    "raw_8": [
        "body_pct",          # (close-open)/open — candle direction + magnitude
        "upper_wick_pct",    # upper wick vs ATR — rejection signal
        "lower_wick_pct",    # lower wick vs ATR — buying pressure
        "close_position",    # where close sits in high-low range (0=low, 1=high)
        "bar_range_vs_atr",  # bar size relative to ATR — volatility expansion
        "volume_rel",        # volume vs 20-bar avg — participation
        "dist_vwap_pct",     # distance to VWAP — institutional fair value
        "atr_rel",           # ATR / price — regime volatility
    ],

    # Lean + news catalyst features
    "lean_news_22": [
        "rsi", "bollinger_pct_b", "volume_rel", "atr_rel",
        "dist_vwap_pct", "dist_hod_pct", "change_5m",
        "minute_of_day", "gap_vs_atr", "bar_range_vs_atr",
        "float_rotation", "buy_volume_ratio",
        # News features
        "has_news_premarket", "has_news_1h",
        "news_count_today", "news_count_premarket",
        "hours_since_news",
        "catalyst_strength",
        "catalyst_is_dilutive", "catalyst_is_earnings",
        "catalyst_is_fda", "catalyst_is_buyout",
    ],

    # News only — pure catalyst signal
    "news_only_10": [
        "has_news_premarket", "has_news_1h",
        "news_count_today", "news_count_premarket",
        "hours_since_news",
        "catalyst_strength",
        "catalyst_is_dilutive", "catalyst_is_earnings",
        "catalyst_is_fda", "catalyst_is_buyout",
    ],

    # RAW extended — raw + context (time + gap + structure)
    "raw_12": [
        "body_pct",
        "upper_wick_pct",
        "lower_wick_pct",
        "close_position",
        "bar_range_vs_atr",
        "volume_rel",
        "dist_vwap_pct",
        "atr_rel",
        "dist_hod_pct",      # distance to high of day — breakout proximity
        "buy_volume_ratio",   # bid vs ask pressure
        "minute_of_day",      # time context
        "gap_vs_atr",         # gap size — opening energy
    ],
}

# ── Targets to test ───────────────────────────────────────────────────────────

TARGETS = [
    "bin_tb30m_tp4p0_sl2p0",   # current default (4% TP / 2% SL, 30 candles)
    "bin_tb30m_tp3p0_sl1p5",   # more conservative (3% TP / 1.5% SL, 30 candles)
    "bin_tb15m_tp3p0_sl1p5",   # shorter horizon (3% TP / 1.5% SL, 15 candles)
    "bin_tb10m_tp2p0_sl0p7",   # tight (2% TP / 0.7% SL, 10 candles)
    "bin_tb10m_tp2p5_sl1p0",   # moderate (2.5% TP / 1.0% SL, 10 candles)
    "bin_tb5m_tp2p0_sl1p0",    # scalp (2% TP / 1% SL, 5 candles)
]

TARGETS_QUICK = [
    "bin_tb30m_tp4p0_sl2p0",
    "bin_tb30m_tp3p0_sl1p5",
    "bin_tb10m_tp2p5_sl1p0",
]

# ── Models to test ────────────────────────────────────────────────────────────

MODELS = ["cnn_lstm", "lstm_attention", "lstm"]
MODELS_QUICK = ["cnn_lstm", "lstm_attention"]


# ── Grid Runner ───────────────────────────────────────────────────────────────

def _create_model(model_type, n_features, hidden_size, num_layers):
    if model_type == "lstm":
        return LSTMMomentum(n_features, hidden_size, num_layers, DEFAULT_DROPOUT)
    elif model_type == "lstm_attention":
        return LSTMWithAttention(n_features, hidden_size, num_layers, DEFAULT_DROPOUT)
    elif model_type == "cnn_lstm":
        return CNNLSTMAttention(n_features, hidden_size, num_layers, DEFAULT_DROPOUT)
    elif model_type == "gru":
        return GRUMomentum(n_features, hidden_size, num_layers, DEFAULT_DROPOUT)
    elif model_type == "transformer":
        return TransformerMomentum(n_features, d_model=hidden_size, nhead=4,
                                     num_layers=num_layers, dropout=DEFAULT_DROPOUT)
    raise ValueError(f"Unknown: {model_type}")


def _already_done(model_type, fset_name, target_name):
    """Check if this combo was already run."""
    if not GRID_CSV.exists():
        return False
    with open(GRID_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if (row.get("model") == model_type and
                row.get("feature_set") == fset_name and
                row.get("target") == target_name):
                return True
    return False


def _write_result(row: dict):
    """Append one result row to the grid CSV."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    file_exists = GRID_CSV.exists()
    with open(GRID_CSV, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=row.keys())
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)


def run_one_combo(
    df_full: pd.DataFrame,
    all_targets: dict,
    model_type: str,
    fset_name: str,
    feature_cols: list,
    target_name: str,
    seq_len: int,
    epochs: int,
    patience: int,
    batch_size: int,
    device: torch.device,
) -> dict | None:
    """Train one model/featureset/target combo. Returns result dict."""

    if _already_done(model_type, fset_name, target_name):
        print(f"  SKIP (already done): {model_type} / {fset_name} / {target_name}")
        return None

    print(f"\n{'═' * 70}")
    print(f"  {model_type.upper()} | {fset_name} ({len(feature_cols)} feat) | {target_name}")
    print(f"{'═' * 70}")

    t_start = time.time()

    # Prepare target
    if target_name not in all_targets:
        print(f"  ERROR: target '{target_name}' not found, skipping")
        return None

    bundle = all_targets[target_name]
    y_full = np.asarray(bundle["y"])
    valid = np.asarray(bundle["valid"]).astype(bool)

    df = df_full.loc[valid].copy()
    df["_target"] = y_full[valid]

    if "valid_for_training" in df.columns:
        df = df[df["valid_for_training"] == 1].reset_index(drop=True)

    pos_rate = (df["_target"] == 1).mean()
    print(f"  Rows: {len(df)}, pos rate: {pos_rate:.1%}")

    if len(df) < 1000 or pos_rate < 0.01 or pos_rate > 0.99:
        print(f"  SKIP: insufficient data or trivial target")
        return None

    # Create datasets
    try:
        train_ds, test_ds, dates_info = create_temporal_datasets(
            df, "_target", feature_cols, seq_len, train_frac=0.8, filter_valid=False,
        )
    except Exception as e:
        print(f"  ERROR creating datasets: {e}")
        return None

    if len(train_ds) < 100 or len(test_ds) < 100:
        print(f"  SKIP: too few sequences (train={len(train_ds)}, test={len(test_ds)})")
        return None

    scaler = dates_info.get("scaler")

    train_labels = np.array([s[1] for s in train_ds.sequences])
    pos_weight = (train_labels == 0).sum() / max((train_labels == 1).sum(), 1)

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=0)
    test_loader = DataLoader(test_ds, batch_size=batch_size, shuffle=False, num_workers=0)

    # Create model
    n_features = train_ds.n_features
    model = _create_model(model_type, n_features, DEFAULT_HIDDEN, DEFAULT_LAYERS)
    model = model.to(device)

    optimizer = torch.optim.Adam(model.parameters(), lr=DEFAULT_LR, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=3, factor=0.5)
    pw = torch.tensor([pos_weight], dtype=torch.float32).to(device)
    criterion = nn.BCEWithLogitsLoss(pos_weight=pw)

    # Train
    best_auc = 0
    best_epoch = 0
    no_improve = 0
    best_state = None

    for epoch in range(1, epochs + 1):
        t0 = time.time()
        train_loss = train_epoch(model, train_loader, optimizer, criterion, device)

        y_true, y_proba = evaluate(model, test_loader, device)
        try:
            auc = roc_auc_score(y_true, y_proba)
        except ValueError:
            auc = 0.5

        scheduler.step(1 - auc)
        elapsed = time.time() - t0

        improved = "★" if auc > best_auc else " "
        if epoch <= 3 or epoch % 5 == 0 or auc > best_auc:
            p60, n60 = precision_at_threshold(y_true, y_proba, 0.60)
            p70, n70 = precision_at_threshold(y_true, y_proba, 0.70)
            print(f"    Ep {epoch:2d} | loss={train_loss:.4f} | AUC={auc:.4f} | "
                  f"P@.60={p60:.3f}({n60:>5d}) | P@.70={p70:.3f}({n70:>5d}) | {elapsed:.0f}s {improved}")

        if auc > best_auc:
            best_auc = auc
            best_epoch = epoch
            no_improve = 0
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
        else:
            no_improve += 1
            if no_improve >= patience:
                print(f"    Early stop at epoch {epoch} (best: {best_epoch})")
                break

    # Final eval with best model
    if best_state is None:
        print(f"  ERROR: no improvement at all")
        return None

    model.load_state_dict(best_state)
    model.eval()
    y_true, y_proba = evaluate(model, test_loader, device)

    try:
        auc = roc_auc_score(y_true, y_proba)
    except ValueError:
        auc = 0.5

    # Compute all P@threshold
    results = {}
    for thr in [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80]:
        p, n = precision_at_threshold(y_true, y_proba, thr)
        results[f"p_at_{thr:.2f}"] = round(p, 4)
        results[f"n_at_{thr:.2f}"] = n

    total_time = time.time() - t_start

    row = {
        "model": model_type,
        "feature_set": fset_name,
        "n_features": n_features,
        "target": target_name,
        "pos_rate": round(pos_rate, 4),
        "train_seqs": len(train_ds),
        "test_seqs": len(test_ds),
        "best_epoch": best_epoch,
        "auc": round(auc, 4),
        **results,
        "time_sec": round(total_time, 1),
    }

    _write_result(row)

    print(f"\n  ✓ AUC={auc:.4f} | best_epoch={best_epoch} | "
          f"P@.60={results['p_at_0.60']:.3f} | P@.70={results['p_at_0.70']:.3f} | "
          f"{total_time:.0f}s")

    # Cleanup
    del model, train_loader, test_loader, train_ds, test_ds
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return row


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=None, help="Path to CSV")
    parser.add_argument("--max-rows", type=int, default=2000000)
    parser.add_argument("--seq-len", type=int, default=DEFAULT_SEQ_LEN)
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS)
    parser.add_argument("--patience", type=int, default=DEFAULT_PATIENCE)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH)
    parser.add_argument("--quick", action="store_true", help="Run subset of combos")
    parser.add_argument("--models", nargs="+", default=None,
                        help="Override model list (e.g. --models cnn_lstm lstm)")
    parser.add_argument("--feature-sets", nargs="+", default=None,
                        help="Override feature sets (e.g. --feature-sets lean_12 full_30)")
    parser.add_argument("--targets", nargs="+", default=None,
                        help="Override targets (e.g. --targets bin_tb30m_tp4p0_sl2p0)")
    args = parser.parse_args()

    if torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    print(f"Device: {device}")

    # Load data once
    print("\n" + "=" * 70)
    print("  LOADING DATA")
    print("=" * 70)

    t0 = time.time()
    if args.csv:
        csv_path = Path(args.csv)
        if not csv_path.is_absolute():
            csv_path = Path(__file__).resolve().parent.parent.parent / args.csv
        df = pd.read_csv(csv_path, low_memory=False)
    else:
        from experiments.data_loader import CSV_PATH
        df = pd.read_csv(CSV_PATH, low_memory=False)

    if args.max_rows and len(df) > args.max_rows:
        df = df.tail(args.max_rows).reset_index(drop=True)
        print(f"  Trimmed to last {args.max_rows} rows")

    print(f"  Loaded {len(df)} rows in {time.time()-t0:.1f}s")

    print("  Adding features...")
    t0 = time.time()
    df = add_features(df)
    print(f"  Features done ({df.shape[1]} cols) in {time.time()-t0:.1f}s")

    print("  Computing targets...")
    t0 = time.time()
    all_targets = compute_target_variants(df)
    print(f"  {len(all_targets)} targets in {time.time()-t0:.1f}s")

    # Build grid
    models = args.models or (MODELS_QUICK if args.quick else MODELS)
    targets = args.targets or (TARGETS_QUICK if args.quick else TARGETS)
    fset_names = args.feature_sets or list(FEATURE_SETS.keys())

    total_combos = len(models) * len(fset_names) * len(targets)
    print(f"\n  Grid: {len(models)} models × {len(fset_names)} feature sets × {len(targets)} targets = {total_combos} combos")
    print(f"  Models: {models}")
    print(f"  Feature sets: {fset_names}")
    print(f"  Targets: {targets}")

    # Run grid
    completed = 0
    skipped = 0
    results = []

    for model_type in models:
        for fset_name in fset_names:
            feature_cols = FEATURE_SETS[fset_name]
            for target_name in targets:
                row = run_one_combo(
                    df_full=df,
                    all_targets=all_targets,
                    model_type=model_type,
                    fset_name=fset_name,
                    feature_cols=feature_cols,
                    target_name=target_name,
                    seq_len=args.seq_len,
                    epochs=args.epochs,
                    patience=args.patience,
                    batch_size=args.batch_size,
                    device=device,
                )
                if row:
                    results.append(row)
                    completed += 1
                else:
                    skipped += 1

    # Summary
    print(f"\n\n{'═' * 70}")
    print(f"  GRID COMPLETE: {completed} trained, {skipped} skipped")
    print(f"{'═' * 70}")

    if results:
        # Sort by AUC descending
        results.sort(key=lambda r: r["auc"], reverse=True)
        print(f"\n  TOP 10 by AUC:")
        print(f"  {'Model':<18} {'Features':<15} {'Target':<28} {'AUC':>6} {'P@.60':>6} {'P@.70':>6} {'#@.70':>6}")
        print(f"  {'─'*18} {'─'*15} {'─'*28} {'─'*6} {'─'*6} {'─'*6} {'─'*6}")
        for r in results[:10]:
            print(f"  {r['model']:<18} {r['feature_set']:<15} {r['target']:<28} "
                  f"{r['auc']:>6.4f} {r['p_at_0.60']:>6.3f} {r['p_at_0.70']:>6.3f} {r['n_at_0.70']:>6d}")

        # Sort by P@0.70 descending (most useful for trading)
        results.sort(key=lambda r: r["p_at_0.70"], reverse=True)
        print(f"\n  TOP 10 by P@0.70:")
        print(f"  {'Model':<18} {'Features':<15} {'Target':<28} {'AUC':>6} {'P@.70':>6} {'#@.70':>6}")
        print(f"  {'─'*18} {'─'*15} {'─'*28} {'─'*6} {'─'*6} {'─'*6}")
        for r in results[:10]:
            print(f"  {r['model']:<18} {r['feature_set']:<15} {r['target']:<28} "
                  f"{r['auc']:>6.4f} {r['p_at_0.70']:>6.3f} {r['n_at_0.70']:>6d}")

    print(f"\n  Results saved to: {GRID_CSV}")


if __name__ == "__main__":
    main()
