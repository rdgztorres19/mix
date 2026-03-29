"""
Data loader para S&P 500 — carga CSV, temporal split, prepare X/y.
"""

from pathlib import Path

import numpy as np
import pandas as pd

from ml.config import CSV_PATH


def load_base_df(csv_path: Path | None = None) -> pd.DataFrame:
    """Load the SP500 features CSV into a DataFrame."""
    path = csv_path or CSV_PATH
    if not path.exists():
        raise FileNotFoundError(f"CSV not found: {path}")

    df = pd.read_csv(path, header=0, low_memory=False)
    df = df.sort_values(["date", "candle_idx"]).reset_index(drop=True)

    # Convert numeric columns
    numeric_cols = [c for c in df.columns if c not in ("date", "candle_time_et", "session")]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    print(f"  Loaded {len(df)} rows, {df.shape[1]} cols from {path.name}")
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
    (targets look 5-60 candles into the future on 1min data).
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
    target_col: str = "_target",
) -> tuple[pd.DataFrame, np.ndarray]:
    """
    Extract X (features) and y (target) from a DataFrame.
    - Drops rows where target is NaN
    - Fills feature NaNs with column median, then 0
    """
    df = df.dropna(subset=[target_col]).copy()
    if len(df) == 0:
        raise ValueError(f"0 rows after dropping NaN in '{target_col}'")

    y = df[target_col].values

    # Use only features that exist in the DataFrame
    available = [c for c in feature_cols if c in df.columns]
    missing = [c for c in feature_cols if c not in df.columns]
    if missing:
        print(f"  Warning: missing features: {missing[:5]}{'...' if len(missing) > 5 else ''}")

    X = df[available].copy()
    X = X.fillna(X.median())
    X = X.fillna(0)
    X = X.replace([np.inf, -np.inf], 0)

    return X, y
