"""
regime_detection.py — HMM-based market regime detection.

Identifies 3 regimes: trending, mean-reverting, volatile/choppy.
Can be used as a feature or to partition training data.

Usage:
  from experiments.regime_detection import fit_regime_hmm, predict_regimes, add_regime_features
"""

import numpy as np
import pandas as pd


def fit_regime_hmm(
    features: np.ndarray,
    n_regimes: int = 3,
    n_iter: int = 100,
    random_state: int = 42,
):
    """
    Fit a Gaussian HMM on market-level features.

    Args:
        features: (n_samples, n_features) array of regime indicators.
                  Suggested: [volatility_15m, volume_rel, vpin_zscore]
        n_regimes: number of hidden states (default 3)
        n_iter: EM iterations
        random_state: for reproducibility

    Returns: fitted hmmlearn.hmm.GaussianHMM model
    """
    from hmmlearn.hmm import GaussianHMM

    # Clean input
    features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)

    model = GaussianHMM(
        n_components=n_regimes,
        covariance_type="full",
        n_iter=n_iter,
        random_state=random_state,
        verbose=False,
    )
    model.fit(features)
    return model


def predict_regimes(
    hmm_model,
    features: np.ndarray,
) -> np.ndarray:
    """Predict regime labels for each observation."""
    features = np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0)
    return hmm_model.predict(features)


def label_regimes(
    regime_ids: np.ndarray,
    features: np.ndarray,
    feature_names: list[str] | None = None,
) -> dict[int, str]:
    """
    Map regime IDs to human-readable names based on feature characteristics.
    Assumes features include volatility and volume metrics.

    - Highest mean volatility cluster → 'volatile'
    - Lowest mean volatility cluster → 'calm'
    - Middle → 'normal'
    """
    names = {}
    vol_col = 0  # assume first feature is volatility

    means = {}
    for rid in np.unique(regime_ids):
        mask = regime_ids == rid
        means[rid] = features[mask, vol_col].mean()

    sorted_by_vol = sorted(means, key=means.get)

    labels = ['calm', 'normal', 'volatile']
    for i, rid in enumerate(sorted_by_vol):
        if i < len(labels):
            names[rid] = labels[i]
        else:
            names[rid] = f'regime_{rid}'

    return names


def add_regime_features(
    df: pd.DataFrame,
    regime_col: str = "hmm_regime",
) -> pd.DataFrame:
    """
    Add regime-derived features to DataFrame.
    Requires regime_col to already exist in df.

    Adds:
      - regime_duration: consecutive bars in current regime
      - regime_transition: 1 if regime changed from prior bar
    """
    if regime_col not in df.columns:
        return df

    regimes = df[regime_col].values
    n = len(regimes)

    duration = np.ones(n, dtype=np.float64)
    transition = np.zeros(n, dtype=np.float64)

    for i in range(1, n):
        if regimes[i] == regimes[i - 1]:
            duration[i] = duration[i - 1] + 1
        else:
            duration[i] = 1
            transition[i] = 1

    df["regime_duration"] = duration
    df["regime_transition"] = transition

    return df


def fit_and_add_regimes(
    df: pd.DataFrame,
    regime_features: list[str] | None = None,
    n_regimes: int = 3,
) -> tuple[pd.DataFrame, object]:
    """
    Convenience: fit HMM and add all regime features in one call.

    Args:
        df: DataFrame with numeric columns
        regime_features: columns to use for HMM (default: volatility_15m, volume_rel)
        n_regimes: number of hidden states

    Returns: (df_with_regime_features, fitted_hmm_model)
    """
    if regime_features is None:
        regime_features = ["volatility_15m", "volume_rel"]

    available = [f for f in regime_features if f in df.columns]
    if len(available) < 2:
        # Not enough features, add dummy regime
        df["hmm_regime"] = 0
        df["regime_duration"] = 1
        df["regime_transition"] = 0
        return df, None

    X = df[available].fillna(0).values
    hmm = fit_regime_hmm(X, n_regimes=n_regimes)
    df["hmm_regime"] = predict_regimes(hmm, X)
    df = add_regime_features(df, "hmm_regime")

    # Label regimes for logging
    labels = label_regimes(df["hmm_regime"].values, X, available)
    print(f"  [HMM] {n_regimes} regimes detected: {labels}")
    for rid, name in labels.items():
        mask = df["hmm_regime"] == rid
        pct = mask.mean() * 100
        print(f"    Regime {rid} ({name}): {pct:.1f}% of data")

    return df, hmm
