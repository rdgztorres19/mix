"""
Data loader for ML experiments.
Loads training.csv (31 cols), handles NaN, temporal split with embargo.
All features are computed in-memory by feature_engineer — CSV is never modified.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

# --- paths ----------------------------------------------------------------
ML_DIR = Path(__file__).resolve().parent.parent          # ml/
STOCK_TRAINING_DIR = ML_DIR.parent                       # stock-training/
CSV_PATH = STOCK_TRAINING_DIR / "data" / "training-v2.csv"  # V2: screener-based, no survivorship bias

# 31 base columns
BASE_COLUMNS = [
    "symbol", "date", "candle_time_et", "candle_idx",
    "open", "high", "low", "close", "volume",
    "atr", "vwap", "high_of_day", "low_of_day",
    "change_pct_at_candle", "ema9", "ema20",
    "pre_market_high", "session",
    "shares_outstanding", "market_cap",
    "gap_pct", "premarket_volume",
    "momentum_acumulado", "change_1m", "change_5m", "change_10m",
    "minutes_since_hod",
    "future_return_5m", "target", "target_break_hod_5m", "max_future_return_10m",
]

# 61-col full schema (positions 28-57 are enriched feature slots, may be empty)
ENRICHED_FEATURE_SLOTS = [
    "volume_rel", "dist_vwap_pct", "atr_rel", "minute_of_day", "rsi", "volatility_15m",
    "mom_5", "mom_10", "return_lag_1", "return_lag_2", "return_lag_3",
    "dist_hod_pct", "dist_lod_pct", "dist_pm_high", "break_hod", "break_pm_high",
    "range_expansion", "float_rotation", "dollar_volume", "relative_dollar_volume",
    "volume_spike", "vwap_cross_up", "dist_ema9", "dist_ema20", "momentum_acceleration",
    "is_open", "is_midday", "is_power_hour", "dist_gap", "relative_range",
]

FULL_COLUMNS = BASE_COLUMNS[:27] + ENRICHED_FEATURE_SLOTS + BASE_COLUMNS[27:]  # 61 total

# Columns that must NOT be used as features (identifiers + labels)
ID_COLUMNS = {"symbol", "date", "candle_time_et", "session"}
LABEL_COLUMNS = {"future_return_5m", "target", "target_break_hod_5m", "max_future_return_10m"}


def load_base_df(csv_path: Path | None = None) -> pd.DataFrame:
    """Load training.csv (31 or 61 cols, no header) into a DataFrame."""
    path = csv_path or CSV_PATH
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {path}")

    with open(path, "r") as f:
        first = f.readline()
    has_header = "symbol" in first.lower()

    if has_header:
        df = pd.read_csv(path, header=0, low_memory=False)
    else:
        ncols = len(first.split(","))
        if ncols >= 55:
            names = FULL_COLUMNS[:ncols] if ncols <= len(FULL_COLUMNS) else FULL_COLUMNS
        else:
            names = BASE_COLUMNS[:ncols] if ncols <= len(BASE_COLUMNS) else BASE_COLUMNS
        df = pd.read_csv(path, header=None, names=names, low_memory=False)

    # Drop empty enriched-slot columns (all NaN) — will be recomputed by feature_engineer
    for col in ENRICHED_FEATURE_SLOTS:
        if col in df.columns:
            if df[col].isna().all() or (df[col] == "").all():
                df = df.drop(columns=[col])

    # Sort temporally: date → symbol → candle_idx
    sort_cols = [c for c in ["date", "symbol", "candle_idx"] if c in df.columns]
    if sort_cols:
        df = df.sort_values(by=sort_cols).reset_index(drop=True)

    return df


def temporal_split(
    X: pd.DataFrame,
    y: np.ndarray,
    train_frac: float = 0.8,
    embargo_rows: int = 30,
):
    """
    Temporal train/test split.
    embargo_rows: gap between train and test to avoid label leakage
    (labels look 5-10 candles into the future).
    """
    n = len(X)
    train_end = int(n * train_frac)
    test_start = min(train_end + embargo_rows, n - 1)
    X_train = X.iloc[:train_end].copy()
    y_train = y[:train_end].copy()
    X_test = X.iloc[test_start:].copy()
    y_test = y[test_start:].copy()
    return X_train, X_test, y_train, y_test


def prepare_Xy(
    df: pd.DataFrame,
    feature_cols: list[str],
    target_col: str = "target",
) -> tuple[pd.DataFrame, np.ndarray]:
    """
    Extract X (features) and y (target) from a DataFrame.
    - Drops rows where target is NaN
    - Fills feature NaNs with column median, then 0
    """
    df = df.dropna(subset=[target_col]).copy()
    if len(df) == 0:
        raise ValueError(f"0 rows after dropping NaN in '{target_col}'")

    y = df[target_col].values.astype(int)

    X = pd.DataFrame(index=df.index)
    for c in feature_cols:
        if c in df.columns:
            X[c] = df[c].values
        else:
            X[c] = 0.0

    # Fill NaN: median for numeric, 0 for rest
    for col in X.columns:
        if X[col].dtype in ("float64", "int64", "float32", "int32"):
            med = X[col].median()
            X[col] = X[col].fillna(med if pd.notna(med) else 0)
    X = X.fillna(0)

    return X, y


def load_df_with_features() -> pd.DataFrame:
    """
    Load CSV + add_features with disk cache.
    Cache is invalidated when training CSV is modified.
    """
    import time as _time
    from experiments.feature_engineer import add_features

    cache_path = Path(__file__).resolve().parent / "results" / "_df_features_cache.pkl"
    cache_mtime_path = Path(str(cache_path) + ".mtime")
    csv_mtime = CSV_PATH.stat().st_mtime if CSV_PATH.exists() else 0

    cache_valid = False
    if cache_path.exists() and cache_mtime_path.exists():
        try:
            stored_mtime = float(cache_mtime_path.read_text().strip())
            if stored_mtime == csv_mtime:
                cache_valid = True
        except Exception:
            pass

    if cache_valid:
        print(f"  Loading cached features...")
        t0 = _time.time()
        df = pd.read_pickle(cache_path)
        print(f"  Cache loaded ({df.shape[1]} cols, {len(df)} rows) in {_time.time() - t0:.1f}s")
    else:
        t0 = _time.time()
        df_base = load_base_df()
        print(f"  Loaded {len(df_base)} rows in {_time.time() - t0:.1f}s")
        print(f"  Adding features...")
        t0 = _time.time()
        df = add_features(df_base)
        print(f"  Feature engineering done ({df.shape[1]} cols) in {_time.time() - t0:.1f}s")
        print(f"  Saving cache...")
        df.to_pickle(cache_path)
        cache_mtime_path.write_text(str(csv_mtime))

    return df
