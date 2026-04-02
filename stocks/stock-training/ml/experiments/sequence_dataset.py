"""
sequence_dataset.py — PyTorch Dataset for momentum sequence prediction.

Converts CSV rows (one per candle) into sliding windows of N candles
for LSTM/Transformer models.

Input: (batch, seq_len, n_features)
Target: scalar (0/1)
"""

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset


# Features optimized for sequence models (relative, no absolute prices)
SEQUENCE_FEATURES = [
    # Price action (relative)
    "body_pct", "upper_wick_pct", "lower_wick_pct", "is_green",
    "bar_range_vs_atr", "close_position",
    # Distances to key levels
    "dist_vwap_pct", "dist_hod_pct", "dist_lod_pct",
    "dist_ema9", "dist_ema20",
    # Momentum
    "change_1m", "change_5m", "roc_5", "roc_10",
    "return_lag_1", "return_lag_2",
    # Oscillators
    "rsi", "stochastic_k", "cci", "williams_r",
    "bollinger_pct_b",
    # Volume (relative)
    "volume_rel", "buy_volume_ratio",
    # Volatility
    "atr_rel", "volatility_15m",
    # Context
    "minute_of_day",
    # Momentum-specific additions
    "float_rotation", "gap_vs_atr", "time_since_open_min",
]


def compute_scaler(sequences: list) -> tuple:
    """
    Fit a RobustScaler on all training sequences.
    Uses median and IQR instead of mean/std — immune to outliers from
    extreme momentum moves (100-500% intraday, 50x volume spikes).
    sequences: list of (X, y) where X is (seq_len, n_features)
    Returns: (median, iqr) each of shape (n_features,)
    """
    all_X = np.concatenate([x for x, _ in sequences], axis=0)  # (N*seq_len, n_features)
    median = np.median(all_X, axis=0)
    q75 = np.percentile(all_X, 75, axis=0)
    q25 = np.percentile(all_X, 25, axis=0)
    iqr = q75 - q25
    iqr = np.where(iqr < 1e-8, 1.0, iqr)  # avoid divide-by-zero for constant features
    return median, iqr


def apply_scaler(sequences: list, mean: np.ndarray, std: np.ndarray) -> list:
    """Apply a pre-fit StandardScaler to a list of (X, y) tuples."""
    return [((x - mean) / std, y) for x, y in sequences]


class MomentumSequenceDataset(Dataset):
    """
    Creates sliding windows of seq_len candles for each (symbol, date) group.
    Only uses candles where valid_for_training == 1 if filter_valid is True.
    """

    def __init__(
        self,
        df: pd.DataFrame,
        feature_cols: list[str] | None = None,
        target_col: str = "_target",
        seq_len: int = 30,
        filter_valid: bool = True,
    ):
        self.seq_len = seq_len
        self.feature_cols = feature_cols or SEQUENCE_FEATURES
        self.target_col = target_col

        # Filter to available features
        available = [f for f in self.feature_cols if f in df.columns]
        if len(available) < len(self.feature_cols):
            missing = set(self.feature_cols) - set(available)
            print(f"  Warning: {len(missing)} features missing: {missing}")
        self.feature_cols = available
        self.n_features = len(self.feature_cols)

        # Build sequences grouped by (symbol, date)
        self.sequences = []  # list of (X_seq, y_target)

        group_cols = ["symbol", "date"]
        has_groups = all(c in df.columns for c in group_cols)

        if has_groups:
            groups = df.groupby(group_cols, sort=False)
        else:
            groups = [("all", df)]

        for _key, grp in groups:
            if filter_valid and "valid_for_training" in grp.columns:
                grp = grp[grp["valid_for_training"] == 1]

            if len(grp) < seq_len + 1:
                continue

            if target_col not in grp.columns:
                continue

            # Extract feature matrix and targets
            feat_matrix = grp[self.feature_cols].values.astype(np.float32)
            targets = grp[target_col].values.astype(np.float32)

            # Replace NaN/inf
            feat_matrix = np.nan_to_num(feat_matrix, nan=0.0, posinf=0.0, neginf=0.0)

            # No z-score normalization — SEQUENCE_FEATURES are already scale-independent
            # by design (percentages, ratios, oscillators 0-100, relative distances).
            # Normalizing destroys absolute level info (e.g. dist_vwap_pct, minute_of_day,
            # rsi level) that is predictive. Inference does the same (no normalization).
            for i in range(seq_len, len(grp)):
                x = feat_matrix[i - seq_len:i].copy()  # (seq_len, n_features)
                y = targets[i]
                if np.isnan(y):
                    continue
                self.sequences.append((x, y))

        print(f"  Dataset: {len(self.sequences)} sequences, "
              f"seq_len={seq_len}, n_features={self.n_features}")

    def __len__(self):
        return len(self.sequences)

    def __getitem__(self, idx):
        x, y = self.sequences[idx]
        return torch.from_numpy(x), torch.tensor(y, dtype=torch.float32)


def create_temporal_datasets(
    df: pd.DataFrame,
    target_col: str = "_target",
    feature_cols: list[str] | None = None,
    seq_len: int = 30,
    train_frac: float = 0.8,
    filter_valid: bool = True,
) -> tuple:
    """
    Split DataFrame temporally by date, then create train/test datasets.
    Returns (train_dataset, test_dataset, dates_info).
    """
    if "date" not in df.columns:
        raise ValueError("DataFrame must have 'date' column")

    dates = sorted(df["date"].unique())
    n_train = int(len(dates) * train_frac)
    embargo_days = 3

    train_dates = set(dates[:n_train])
    test_dates = set(dates[n_train + embargo_days:])

    train_df = df[df["date"].isin(train_dates)]
    test_df = df[df["date"].isin(test_dates)]

    print(f"  Temporal split: {len(train_dates)} train days, {len(test_dates)} test days")
    print(f"  Train: {min(train_dates)} → {max(train_dates)}")
    print(f"  Test:  {min(test_dates)} → {max(test_dates)}")

    train_ds = MomentumSequenceDataset(train_df, feature_cols, target_col, seq_len, filter_valid)

    # Fit scaler on training sequences only (no lookahead), apply to both splits
    mean, std = compute_scaler(train_ds.sequences)
    train_ds.sequences = apply_scaler(train_ds.sequences, mean, std)

    test_ds = MomentumSequenceDataset(test_df, feature_cols, target_col, seq_len, filter_valid)
    test_ds.sequences = apply_scaler(test_ds.sequences, mean, std)

    return train_ds, test_ds, {"train_dates": train_dates, "test_dates": test_dates, "scaler": (mean, std)}
