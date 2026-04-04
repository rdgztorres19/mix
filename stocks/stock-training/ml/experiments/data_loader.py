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
import os as _os
ML_DIR = Path(__file__).resolve().parent.parent          # ml/
STOCK_TRAINING_DIR = ML_DIR.parent                       # stock-training/
_csv_override = _os.environ.get("TRAINING_CSV")
CSV_PATH = (STOCK_TRAINING_DIR / _csv_override) if _csv_override else (STOCK_TRAINING_DIR / "data" / "training-v2.csv")

# 31 base columns (32 with valid_for_training)
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
    "valid_for_training",
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

# Columns that must NOT be used as features (identifiers + labels + meta)
ID_COLUMNS = {"symbol", "date", "candle_time_et", "session"}
LABEL_COLUMNS = {"future_return_5m", "target", "target_break_hod_5m", "max_future_return_10m"}
META_COLUMNS = {"valid_for_training"}  # not a feature, not a label — used for filtering


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


def walk_forward_splits(
    df: pd.DataFrame,
    train_weeks: int = 8,
    test_weeks: int = 1,
    embargo_days: int = 3,
    min_train_samples: int = 500,
) -> list[tuple[pd.DataFrame, pd.DataFrame]]:
    """
    Walk-forward validation: train on N weeks, test on next week, advance 1 week.
    Much more realistic than a single temporal split.

    Returns list of (train_df, test_df) tuples.
    Requires 'date' column in df.
    """
    if "date" not in df.columns:
        raise ValueError("DataFrame must have a 'date' column for walk-forward splits")

    dates = sorted(df["date"].unique())
    if len(dates) < 2:
        return []

    from datetime import timedelta

    # Convert to datetime if needed
    date_map = {d: pd.Timestamp(d) for d in dates}
    min_date = min(date_map.values())
    max_date = max(date_map.values())

    splits = []
    test_start = min_date + timedelta(weeks=train_weeks)

    while test_start + timedelta(weeks=test_weeks) <= max_date:
        train_start = test_start - timedelta(weeks=train_weeks)
        embargo_end = test_start + timedelta(days=embargo_days)
        test_end = test_start + timedelta(weeks=test_weeks)

        train_dates = set()
        test_dates = set()
        for d, ts in date_map.items():
            if train_start <= ts < test_start:
                train_dates.add(d)
            elif embargo_end <= ts < test_end:
                test_dates.add(d)

        if not train_dates or not test_dates:
            test_start += timedelta(weeks=test_weeks)
            continue

        train_df = df[df["date"].isin(train_dates)]
        test_df = df[df["date"].isin(test_dates)]

        if len(train_df) >= min_train_samples and len(test_df) > 50:
            splits.append((train_df, test_df))

        test_start += timedelta(weeks=test_weeks)

    return splits


def cpcv_split(
    X: pd.DataFrame,
    y: np.ndarray,
    n_splits: int = 10,
    n_test_groups: int = 2,
    embargo_pct: float = 0.01,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """
    Combinatorial Purged Cross-Validation (CPCV).
    López de Prado (2018) — Advances in Financial Machine Learning.

    Splits data into n_splits chronological groups. Tests each combination
    of n_test_groups groups. Purges train rows near test boundaries.

    Total paths = C(n_splits, n_test_groups).
    n_splits=10, n_test_groups=2 → 45 paths
    n_splits=5, n_test_groups=2 → 10 paths (quick mode)
    """
    from itertools import combinations

    n = len(X)
    embargo_size = max(1, int(n * embargo_pct))

    # Split into chronological groups
    group_size = n // n_splits
    group_boundaries = []
    for g in range(n_splits):
        start = g * group_size
        end = (g + 1) * group_size if g < n_splits - 1 else n
        group_boundaries.append((start, end))

    indices = np.arange(n)
    splits = []

    for test_groups in combinations(range(n_splits), n_test_groups):
        # Test indices: union of selected groups
        test_idx = np.concatenate([
            indices[group_boundaries[g][0]:group_boundaries[g][1]]
            for g in test_groups
        ])

        # Train indices: everything else, with purging + embargo
        test_set = set(test_idx)
        purge_set = set()

        for g in test_groups:
            g_start, g_end = group_boundaries[g]
            # Purge: embargo_size rows before and after each test group
            for i in range(max(0, g_start - embargo_size), min(n, g_end + embargo_size)):
                purge_set.add(i)

        train_idx = np.array([i for i in indices if i not in test_set and i not in purge_set])

        if len(train_idx) > 0 and len(test_idx) > 0:
            splits.append((train_idx, test_idx))

    return splits


def cluster_features(
    X: pd.DataFrame,
    corr_threshold: float = 0.85,
) -> list[str]:
    """
    Hierarchical clustering of features by Spearman correlation.
    Returns one representative feature per cluster (highest variance).
    Reduces ~86 redundant features to ~15-20 independent signals.
    """
    from scipy.cluster.hierarchy import linkage, fcluster
    from scipy.spatial.distance import squareform

    # Spearman correlation
    corr = X.corr(method='spearman').fillna(0)
    # Convert to distance matrix
    distance = 1 - corr.abs()
    np.fill_diagonal(distance.values, 0)
    distance = distance.clip(lower=0)

    # Hierarchical clustering
    condensed = squareform(distance.values)
    Z = linkage(condensed, method='average')
    clusters = fcluster(Z, t=1 - corr_threshold, criterion='distance')

    # Select one feature per cluster: highest variance
    selected = []
    for cluster_id in np.unique(clusters):
        mask = clusters == cluster_id
        cluster_cols = [X.columns[i] for i, m in enumerate(mask) if m]
        # Pick feature with highest variance
        variances = {col: X[col].var() for col in cluster_cols}
        best = max(variances, key=variances.get)
        selected.append(best)

    return sorted(selected)


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


def load_df_with_features(filter_valid: bool = False) -> pd.DataFrame:
    """
    Load CSV + add_features with disk cache.
    Cache is invalidated when training CSV is modified.

    If filter_valid=True and 'valid_for_training' column exists,
    features are computed on ALL rows (for correct indicators),
    but only valid rows are returned (no lookahead bias).
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
        import os as _os
        max_rows = int(_os.environ.get("TRAINING_MAX_ROWS", "0")) or None
        df_base = load_base_df()
        if max_rows and len(df_base) > max_rows:
            # Keep the LAST max_rows (most recent data)
            df_base = df_base.tail(max_rows).reset_index(drop=True)
            print(f"  Trimmed to last {max_rows} rows")
        print(f"  Loaded {len(df_base)} rows in {_time.time() - t0:.1f}s")

        # Drop invalid rows early to save memory (features still compute correctly
        # because we keep all rows per symbol-day group, just fewer symbol-days)
        if filter_valid and "valid_for_training" in df_base.columns:
            # Keep only symbol-days that have at least 1 valid row
            # But we need ALL candles of those symbol-days for correct indicators
            valid_sym_dates = df_base[df_base["valid_for_training"] == 1][["symbol", "date"]].drop_duplicates()
            n_before = len(df_base)
            df_base = df_base.merge(valid_sym_dates, on=["symbol", "date"], how="inner")
            print(f"  Filtered to valid symbol-days: {n_before} → {len(df_base)} rows")

        print(f"  Adding features...")
        t0 = _time.time()
        df = add_features(df_base)
        del df_base  # free memory
        print(f"  Feature engineering done ({df.shape[1]} cols) in {_time.time() - t0:.1f}s")

    # Filter to only valid-for-training rows (no lookahead bias)
    if filter_valid and "valid_for_training" in df.columns:
        n_before = len(df)
        df = df[df["valid_for_training"] == 1].reset_index(drop=True)
        print(f"  Filtered valid_for_training: {n_before} → {len(df)} rows ({n_before - len(df)} removed)")

    return df
