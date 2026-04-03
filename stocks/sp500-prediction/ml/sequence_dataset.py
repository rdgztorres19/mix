"""
sequence_dataset.py — PyTorch Dataset for SPY 1-min sequence prediction.

Converts CSV rows into sliding windows of N candles for LSTM/CNN-LSTM/Transformer.
Groups by date only (single symbol — SPY).

Input:  (batch, seq_len, n_features)
Target: scalar (0/1)
"""

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset


# SPY-specific sequence features (38 features, all relative/normalized — no absolute prices)
SPY_SEQUENCE_FEATURES = [
    # Distances to key levels (all relative)
    "dist_vwap_pct", "dist_hod_pct", "dist_lod_pct",
    "dist_ema9", "dist_ema20", "dist_gap",
    # Price action
    "bar_range_vs_atr", "range_expansion", "atr_rel",
    # Momentum
    "change_1m", "change_5m", "change_10m",
    "roc_5", "roc_10",
    "return_lag_1", "return_lag_2", "return_lag_3",
    "momentum_acceleration", "z_score_20",
    # Oscillators
    "rsi",
    # Volume (relative)
    "volume_rel", "volume_profile_ratio", "obv_slope_5",
    # Volatility multi-scale
    "volatility_5m", "volatility_15m", "volatility_30m",
    "vol_ratio_5_30", "parkinson_vol",
    # VIX proxy (SPY-specific — #1 predictor per feature importance research)
    "vix_proxy_level", "vix_proxy_change", "uvxy_change_5m", "uvxy_rsi",
    "spy_uvxy_corr_20",
    # Microstructure
    "return_autocorr_20", "amihud_illiquidity", "vwap_slope_norm",
    # Session/context
    "minute_of_day", "is_first_30min", "is_power_hour",
    # Structure
    "break_hod", "minutes_since_hod",
]


def compute_scaler(sequences: list) -> tuple:
    """
    Fit a RobustScaler on all training sequences.
    Uses median and IQR — immune to outliers from VIX spikes and gap days.
    sequences: list of (X, y) where X is (seq_len, n_features)
    Returns: (median, iqr) each of shape (n_features,)
    """
    all_X = np.concatenate([x for x, _ in sequences], axis=0)
    median = np.median(all_X, axis=0)
    q75 = np.percentile(all_X, 75, axis=0)
    q25 = np.percentile(all_X, 25, axis=0)
    iqr = q75 - q25
    iqr = np.where(iqr < 1e-8, 1.0, iqr)
    return median, iqr


def apply_scaler(sequences: list, mean: np.ndarray, std: np.ndarray) -> list:
    """Apply a pre-fit scaler to a list of (X, y) tuples."""
    return [((x - mean) / std, y) for x, y in sequences]


class SPYSequenceDataset(Dataset):
    """
    Creates sliding windows of seq_len candles grouped by date.
    SPY is a single symbol — group by date only (no symbol column).
    """

    def __init__(
        self,
        df: pd.DataFrame,
        feature_cols: list[str] | None = None,
        target_col: str = "_target",
        seq_len: int = 60,
    ):
        self.seq_len = seq_len
        self.feature_cols = feature_cols or SPY_SEQUENCE_FEATURES

        # Filter to available features
        available = [f for f in self.feature_cols if f in df.columns]
        if len(available) < len(self.feature_cols):
            missing = set(self.feature_cols) - set(available)
            print(f"  Warning: {len(missing)} features missing: {missing}")
        self.feature_cols = available
        self.n_features = len(self.feature_cols)

        self.sequences = []  # list of (X_seq, y_target)

        if "date" in df.columns:
            groups = df.groupby("date", sort=False)
        else:
            groups = [("all", df)]

        for _date, grp in groups:
            if len(grp) < seq_len + 1:
                continue
            if target_col not in grp.columns:
                continue

            feat_matrix = grp[self.feature_cols].values.astype(np.float32)
            targets = grp[target_col].values.astype(np.float32)
            feat_matrix = np.nan_to_num(feat_matrix, nan=0.0, posinf=0.0, neginf=0.0)

            for i in range(seq_len, len(grp)):
                x = feat_matrix[i - seq_len:i].copy()
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
    seq_len: int = 60,
    train_frac: float = 0.8,
) -> tuple:
    """
    Split DataFrame temporally by date, create train/test datasets.
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

    train_ds = SPYSequenceDataset(train_df, feature_cols, target_col, seq_len)

    mean, std = compute_scaler(train_ds.sequences)
    train_ds.sequences = apply_scaler(train_ds.sequences, mean, std)

    test_ds = SPYSequenceDataset(test_df, feature_cols, target_col, seq_len)
    test_ds.sequences = apply_scaler(test_ds.sequences, mean, std)

    return train_ds, test_ds, {"train_dates": train_dates, "test_dates": test_dates, "scaler": (mean, std)}
