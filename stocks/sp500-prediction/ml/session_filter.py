"""
Session filter — filtra datos por ventana de tiempo del dia.
SPY tiene 3 regimenes intraday con dinamicas completamente diferentes:

  OPEN     = 09:30 - 10:00 (30 min) — alta volatilidad, gap plays, institutional flow
  MIDDAY   = 10:00 - 14:30 (270 min) — baja vol, mean reversion, ruido
  POWER    = 14:30 - 16:00 (90 min) — MOC orders, tendencias fuertes

El midday es ~70% del dia pero tiene el peor signal-to-noise ratio.
Entrenar modelos separados para OPEN y POWER mejora precision significativamente.
"""

import pandas as pd

# Market open = 9:30 ET = minute 570
_MARKET_OPEN = 9 * 60 + 30

# Session definitions (minute_of_day ranges)
SESSIONS = {
    "open": (_MARKET_OPEN, _MARKET_OPEN + 30),         # 09:30 - 10:00
    "morning": (_MARKET_OPEN, _MARKET_OPEN + 60),       # 09:30 - 10:30
    "midday": (_MARKET_OPEN + 60, 14 * 60 + 30),        # 10:30 - 14:30
    "power": (14 * 60 + 30, 16 * 60),                   # 14:30 - 16:00
    "active": None,                                       # open + power (no midday)
    "all": None,                                          # no filter
}


def _parse_minute_of_day(time_str) -> int:
    if not isinstance(time_str, str):
        return 0
    parts = time_str.split(":")
    if len(parts) < 2:
        return 0
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return 0


def filter_session(df: pd.DataFrame, session: str) -> pd.DataFrame:
    """Filter DataFrame to only include rows from the specified session."""
    if session == "all" or session not in SESSIONS:
        return df

    # Ensure minute_of_day column exists
    if "minute_of_day" not in df.columns:
        if "candle_time_et" in df.columns:
            df = df.copy()
            df["minute_of_day"] = df["candle_time_et"].apply(_parse_minute_of_day)
        else:
            return df

    if session == "active":
        # Open + Power hour (skip midday noise)
        open_start, open_end = SESSIONS["open"]
        power_start, power_end = SESSIONS["power"]
        mask = (
            ((df["minute_of_day"] >= open_start) & (df["minute_of_day"] < open_end)) |
            ((df["minute_of_day"] >= power_start) & (df["minute_of_day"] < power_end))
        )
        return df[mask].reset_index(drop=True)

    start, end = SESSIONS[session]
    mask = (df["minute_of_day"] >= start) & (df["minute_of_day"] < end)
    return df[mask].reset_index(drop=True)
