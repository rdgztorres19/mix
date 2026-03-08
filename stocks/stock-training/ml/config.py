"""
Configuración compartida para todos los métodos ML.
Paths, columnas y target para el CSV de 1 minuto.
"""

from pathlib import Path

# Path al CSV (relativo a ml/)
ML_DIR = Path(__file__).resolve().parent
STOCK_TRAINING_DIR = ML_DIR.parent
CSV_PATH = STOCK_TRAINING_DIR / "data" / "training-enriched.csv"

# Columnas del CSV base (31) — usamos solo estas para train (old features)
CSV_COLUMNS = [
    "symbol",
    "date",
    "candle_time_et",
    "candle_idx",
    "open",
    "high",
    "low",
    "close",
    "volume",
    "atr",
    "vwap",
    "high_of_day",
    "low_of_day",
    "change_pct_at_candle",
    "ema9",
    "ema20",
    "pre_market_high",
    "session",
    "shares_outstanding",
    "market_cap",
    "gap_pct",
    "premarket_volume",
    "momentum_acumulado",
    "change_1m",
    "change_5m",
    "change_10m",
    "minutes_since_hod",
    "future_return_5m",
    "target",
    "target_break_hod_5m",
    "max_future_return_10m",
]

# Schema completo para training-enriched (momentum intradía ~60 cols)
CSV_COLUMNS_FULL = CSV_COLUMNS[:27] + [
    "volume_rel", "dist_vwap_pct", "atr_rel", "minute_of_day", "rsi", "volatility_15m",
    "mom_5", "mom_10", "return_lag_1", "return_lag_2", "return_lag_3",
    "dist_hod_pct", "dist_lod_pct", "dist_pm_high", "break_hod", "break_pm_high",
    "range_expansion", "float_rotation", "dollar_volume", "relative_dollar_volume",
    "volume_spike", "vwap_cross_up", "dist_ema9", "dist_ema20", "momentum_acceleration",
    "is_open", "is_midday", "is_power_hour", "dist_gap", "relative_range",
] + list(CSV_COLUMNS[27:])

# Columnas a excluir como features (identificadores o categóricas)
EXCLUDE_FEATURES = {"symbol", "date", "candle_time_et", "session"}

# Labels a excluir de features
EXCLUDE_LABELS = {"future_return_5m", "target_break_hod_5m", "max_future_return_10m"}

# Target para clasificación
TARGET_COLUMN = "target"

# Umbral de probabilidad para considerar "tradeable" (solo tradear si P(bullish) > X)
BULLISH_PROBA_THRESHOLD = 0.7

# Features numéricas — usar schema completo (41 cols) para coincidir con el modelo entrenado
def get_feature_columns():
    exclude = EXCLUDE_FEATURES | EXCLUDE_LABELS | {TARGET_COLUMN}
    return [c for c in CSV_COLUMNS_FULL if c not in exclude]


FEATURE_COLUMNS = get_feature_columns()
