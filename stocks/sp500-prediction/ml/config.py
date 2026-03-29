"""
Configuracion compartida para el pipeline ML de S&P 500 intraday.
Paths, columnas, feature sets y targets — 1 min candles de SPY.
"""

from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
PROJECT_DIR = ML_DIR.parent
CSV_PATH = PROJECT_DIR / "data" / "processed" / "sp500_training.csv"

# Columnas base del CSV generado por build-csv.ts (30 columnas)
CSV_COLUMNS = [
    "date", "candle_time_et", "candle_idx",
    "open", "high", "low", "close", "volume",
    "atr", "vwap", "high_of_day", "low_of_day",
    "change_pct", "ema9", "ema20",
    "pre_market_high", "session",
    "gap_pct", "premarket_volume",
    "change_1m", "change_5m", "change_10m",
    "minutes_since_hod",
    # UVXY (VIX proxy)
    "uvxy_close", "uvxy_change_pct", "uvxy_volume",
    # Labels
    "future_return_5m", "future_return_10m",
    "max_future_return_10m", "min_future_return_10m",
]

# Columnas excluidas de features
EXCLUDE_FEATURES = {"date", "candle_time_et", "session"}

# Labels (no son features)
EXCLUDE_LABELS = {
    "future_return_5m", "future_return_10m",
    "max_future_return_10m", "min_future_return_10m",
}

# Target por defecto
TARGET_COLUMN = "future_return_5m"

# Umbral de probabilidad
BULLISH_PROBA_THRESHOLD = 0.7


# ── Feature Sets ─────────────────────────────────────────────────────────────

# Base features del CSV (computadas en TypeScript)
FEATURES_BASE = [
    "candle_idx",
    "open", "high", "low", "close", "volume",
    "atr", "vwap", "high_of_day", "low_of_day",
    "change_pct", "ema9", "ema20",
    "pre_market_high",
    "gap_pct", "premarket_volume",
    "change_1m", "change_5m", "change_10m",
    "minutes_since_hod",
    "uvxy_close", "uvxy_change_pct", "uvxy_volume",
]

# Enriched features (computadas por feature_engineer.py)
FEATURES_ENRICHED = [
    # Distance (all relative)
    "dist_vwap_pct", "dist_hod_pct", "dist_lod_pct",
    "dist_ema9", "dist_ema20", "dist_gap",
    "atr_rel", "bar_range_vs_atr", "range_expansion",
    # Volume
    "volume_rel", "volume_spike", "relative_dollar_volume",
    "dollar_volume", "obv_slope_5", "volume_profile_ratio",
    # Momentum
    "rsi", "roc_3", "roc_5", "roc_10", "roc_20",
    "return_lag_1", "return_lag_2", "return_lag_3",
    "mom_5", "mom_10", "momentum_acceleration",
    "z_score_20",
    # Microstructure proxies (NEW)
    "return_autocorr_20", "amihud_illiquidity", "kyle_lambda",
    "vwap_slope_norm",
    # Multi-scale volatility (NEW)
    "volatility_5m", "volatility_15m", "volatility_30m",
    "vol_ratio_5_30", "vol_ratio_5_15", "parkinson_vol",
    # VIX proxy (NEW)
    "vix_proxy_level", "vix_proxy_change", "vix_proxy_volume_rel",
    "spy_uvxy_corr_20", "uvxy_change_5m", "uvxy_rsi",
    # Session / structural
    "minute_of_day", "is_first_30min", "is_open", "is_midday", "is_power_hour",
    "break_hod", "vwap_cross_up", "relative_range",
]

FEATURE_SETS = {
    # Everything from CSV
    "A_base": FEATURES_BASE,

    # CSV + all engineered
    "B_enriched": FEATURES_BASE + FEATURES_ENRICHED,

    # Price action focused
    "C_price_action": [
        "candle_idx", "atr", "atr_rel",
        "dist_vwap_pct", "dist_hod_pct", "dist_lod_pct",
        "dist_ema9", "dist_ema20", "dist_gap",
        "bar_range_vs_atr", "range_expansion", "relative_range",
        "break_hod", "vwap_cross_up",
        "rsi", "momentum_acceleration",
        "minutes_since_hod",
        "volume_rel", "volume_spike", "dollar_volume",
        "parkinson_vol",
    ],

    # Momentum + volatility
    "D_momentum": [
        "candle_idx",
        "change_pct", "change_1m", "change_5m", "change_10m",
        "rsi", "mom_5", "mom_10", "momentum_acceleration",
        "roc_3", "roc_5", "roc_10", "roc_20",
        "return_lag_1", "return_lag_2", "return_lag_3",
        "return_autocorr_20",
        "volume_rel", "volume_spike", "obv_slope_5",
        "volatility_5m", "volatility_15m", "volatility_30m",
        "vol_ratio_5_30", "parkinson_vol",
        "z_score_20", "dist_vwap_pct", "dist_hod_pct",
        "minutes_since_hod", "gap_pct",
    ],

    # Curated causal features (no noise)
    "E_clean": [
        "candle_idx", "atr_rel",
        "change_pct", "change_1m", "change_5m", "change_10m",
        "rsi", "momentum_acceleration",
        "dist_vwap_pct", "dist_hod_pct", "dist_lod_pct",
        "dist_ema9", "dist_ema20", "dist_gap",
        "volume_rel", "dollar_volume",
        "break_hod", "vwap_cross_up",
        "minutes_since_hod", "gap_pct",
        "volatility_15m", "z_score_20",
        "return_autocorr_20",
        "vix_proxy_change",
        "is_first_30min", "is_power_hour",
    ],

    # Everything
    "F_all": FEATURES_BASE + FEATURES_ENRICHED,

    # ── NEW: SPY-optimized (~20 features, top predictors only) ──
    # Based on feature importance research for SPY intraday:
    # Tier 1: VIX, volatility, volume, autocorrelation, time-of-day
    # Tier 2: VWAP distance, RSI, illiquidity, momentum
    "G_spy_optimized": [
        # VIX proxy (Tier 1 — #1 predictor for SPY)
        "vix_proxy_level", "vix_proxy_change", "uvxy_change_5m",
        # Volatility multi-scale (Tier 1)
        "volatility_5m", "volatility_15m", "volatility_30m",
        "vol_ratio_5_30", "parkinson_vol",
        # Volume (Tier 1)
        "volume_rel", "volume_profile_ratio",
        # Mean-reversion signal (Tier 1)
        "return_autocorr_20",
        # Time of day (Tier 1)
        "minute_of_day", "is_first_30min", "is_power_hour",
        # VWAP + structure (Tier 2)
        "dist_vwap_pct", "vwap_slope_norm",
        # RSI at extremes (Tier 2)
        "rsi",
        # Microstructure proxies (Tier 2)
        "amihud_illiquidity", "kyle_lambda",
        # Momentum (Tier 2)
        "change_5m", "momentum_acceleration", "z_score_20",
        # Structure
        "dist_hod_pct", "minutes_since_hod",
    ],
}
