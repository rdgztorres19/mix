"""
Feature engineering — compute ~25 new features in-memory from the base 31-col CSV.
Groups by (symbol, date) to respect per-stock-day boundaries.
Never modifies the original CSV.
"""

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Helper: per-group rolling / lagged computations
# ---------------------------------------------------------------------------

def _safe_div(a, b, fill=0.0):
    """Element-wise a/b, filling inf/nan with `fill`."""
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.where(b != 0, a / b, fill)
    return np.where(np.isfinite(r), r, fill)


def _rolling_std(arr: np.ndarray, window: int) -> np.ndarray:
    s = pd.Series(arr)
    return s.rolling(window, min_periods=1).std().fillna(0).values


def _rolling_mean(arr: np.ndarray, window: int) -> np.ndarray:
    s = pd.Series(arr)
    return s.rolling(window, min_periods=1).mean().fillna(0).values


def _rolling_sum(arr: np.ndarray, window: int) -> np.ndarray:
    s = pd.Series(arr)
    return s.rolling(window, min_periods=1).sum().fillna(0).values


def _rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
    """Wilder RSI."""
    deltas = np.diff(closes, prepend=closes[0])
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = pd.Series(gains).rolling(period, min_periods=1).mean().values
    avg_loss = pd.Series(losses).rolling(period, min_periods=1).mean().values
    rs = _safe_div(avg_gain, avg_loss, fill=0.0)
    rsi = 100.0 - 100.0 / (1.0 + rs)
    return np.where(np.isfinite(rsi), rsi, 50.0)


def _ema(arr: np.ndarray, span: int) -> np.ndarray:
    return pd.Series(arr).ewm(span=span, adjust=False).mean().fillna(arr[0] if len(arr) else 0).values


def _obv(closes: np.ndarray, volumes: np.ndarray) -> np.ndarray:
    """On-Balance Volume."""
    signs = np.sign(np.diff(closes, prepend=closes[0]))
    return np.cumsum(signs * volumes)


def _consecutive_count(bools: np.ndarray) -> np.ndarray:
    """Count consecutive True values ending at each position."""
    out = np.zeros(len(bools), dtype=np.float64)
    count = 0
    for i in range(len(bools)):
        if bools[i]:
            count += 1
        else:
            count = 0
        out[i] = count
    return out


# ---------------------------------------------------------------------------
# Minute-of-day parser
# ---------------------------------------------------------------------------

_MARKET_OPEN_MIN = 9 * 60 + 30  # 9:30 ET


def _parse_minute_of_day(time_str) -> int:
    """Parse 'HH:MM' → minutes since midnight, returns 0 on failure."""
    if not isinstance(time_str, str):
        return 0
    parts = time_str.split(":")
    if len(parts) < 2:
        return 0
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return 0


# ---------------------------------------------------------------------------
# Main: add features to a DataFrame grouped by (symbol, date)
# ---------------------------------------------------------------------------

def add_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add ~25 engineered features to `df` in-place (returns same df).
    Expects base columns: open, high, low, close, volume, atr, vwap,
    high_of_day, low_of_day, ema9, ema20, pre_market_high, candle_time_et,
    shares_outstanding, gap_pct, premarket_volume, change_1m.
    """
    df = df.copy()

    # Pre-compute minute_of_day from candle_time_et
    if "candle_time_et" in df.columns:
        df["minute_of_day"] = df["candle_time_et"].apply(_parse_minute_of_day)
        df["time_since_open_min"] = (df["minute_of_day"] - _MARKET_OPEN_MIN).clip(lower=0)
    else:
        df["minute_of_day"] = 0
        df["time_since_open_min"] = 0

    # Time-of-day session flags
    df["is_premarket"] = (df["minute_of_day"] < _MARKET_OPEN_MIN).astype(np.float64)
    df["is_first_30min"] = ((df["minute_of_day"] >= _MARKET_OPEN_MIN) &
                             (df["minute_of_day"] < _MARKET_OPEN_MIN + 30)).astype(np.float64)
    df["is_open"] = ((df["minute_of_day"] >= _MARKET_OPEN_MIN) &
                      (df["minute_of_day"] < _MARKET_OPEN_MIN + 60)).astype(np.float64)
    df["is_midday"] = ((df["minute_of_day"] >= _MARKET_OPEN_MIN + 120) &
                        (df["minute_of_day"] < _MARKET_OPEN_MIN + 270)).astype(np.float64)
    df["is_power_hour"] = (df["minute_of_day"] >= 15 * 60).astype(np.float64)  # 3pm+
    df["is_last_hour"] = (df["minute_of_day"] >= 15 * 60 + 30).astype(np.float64)  # 3:30pm+

    # --- Features that don't need grouping ---
    o = df["open"].values.astype(np.float64)
    h = df["high"].values.astype(np.float64)
    lo = df["low"].values.astype(np.float64)
    c = df["close"].values.astype(np.float64)
    v = df["volume"].values.astype(np.float64)
    atr = df["atr"].values.astype(np.float64) if "atr" in df.columns else np.ones(len(df))
    vwap = df["vwap"].values.astype(np.float64) if "vwap" in df.columns else c.copy()
    hod = df["high_of_day"].values.astype(np.float64) if "high_of_day" in df.columns else h.copy()
    lod = df["low_of_day"].values.astype(np.float64) if "low_of_day" in df.columns else lo.copy()
    ema9 = df["ema9"].values.astype(np.float64) if "ema9" in df.columns else c.copy()
    ema20 = df["ema20"].values.astype(np.float64) if "ema20" in df.columns else c.copy()
    pmh = df["pre_market_high"].values.astype(np.float64) if "pre_market_high" in df.columns else h.copy()

    # Price action features
    df["body_pct"] = _safe_div(c - o, np.maximum(np.abs(o), 1e-6))
    df["upper_wick_pct"] = _safe_div(h - np.maximum(o, c), np.maximum(atr, 1e-6))
    df["lower_wick_pct"] = _safe_div(np.minimum(o, c) - lo, np.maximum(atr, 1e-6))
    df["is_green"] = (c > o).astype(np.float64)
    df["bar_range_vs_atr"] = _safe_div(h - lo, np.maximum(atr, 1e-6))

    # Distance features (relative to key levels)
    df["dist_vwap_pct"] = _safe_div(c - vwap, np.maximum(np.abs(vwap), 1e-6))
    df["dist_hod_pct"] = _safe_div(c - hod, np.maximum(np.abs(hod), 1e-6))
    df["dist_lod_pct"] = _safe_div(c - lod, np.maximum(np.abs(lod), 1e-6))
    df["dist_ema9"] = _safe_div(c - ema9, np.maximum(np.abs(ema9), 1e-6))
    df["dist_ema20"] = _safe_div(c - ema20, np.maximum(np.abs(ema20), 1e-6))
    df["dist_pm_high"] = _safe_div(c - pmh, np.maximum(np.abs(pmh), 1e-6))
    df["atr_rel"] = _safe_div(atr, np.maximum(np.abs(c), 1e-6))

    # Break signals (overwritten per-group with prev_hod logic)

    # Range expansion
    day_range = np.maximum(hod - lod, 1e-6)
    df["range_expansion"] = _safe_div(h - lo, day_range)
    df["pct_of_day_range"] = _safe_div(c - lod, day_range)

    # Spread estimate (proxy) — alias bar_range_pct (rango relativo de la vela)
    df["spread_estimate"] = _safe_div(h - lo, np.maximum(np.abs(c), 1e-6))
    df["bar_range_pct"] = df["spread_estimate"]

    # Dollar volume
    df["dollar_volume"] = c * v

    # Distance to round number
    df["dist_to_round_number"] = np.minimum(c % 1.0, 1.0 - (c % 1.0))

    # --- Per-group features (need rolling within symbol+date) ---
    grouped_frames = []
    group_cols = ["symbol", "date"]
    has_groups = all(c in df.columns for c in group_cols)

    if has_groups:
        groups = df.groupby(group_cols, sort=False)
    else:
        groups = [(None, df)]

    for _key, grp in groups:
        grp = grp.copy()
        go = grp["open"].values.astype(np.float64)
        gh = grp["high"].values.astype(np.float64)
        gc = grp["close"].values.astype(np.float64)
        gv = grp["volume"].values.astype(np.float64)
        gatr = grp["atr"].values.astype(np.float64) if "atr" in grp.columns else np.ones(len(grp))
        ghod = grp["high_of_day"].values.astype(np.float64) if "high_of_day" in grp.columns else gh.copy()

        # prev_hod: rolling max of high EXCLUDING current bar (for breakout logic)
        running_max_h = np.maximum.accumulate(gh)
        prev_hod = np.zeros(len(gh))
        prev_hod[1:] = running_max_h[:-1]

        # break_hod, break_prev_hod: use prev_hod (distance to prior high)
        grp["break_hod"] = (gc > prev_hod).astype(np.float64)
        grp["break_prev_hod_high"] = (gh > prev_hod).astype(np.float64)
        grp["break_prev_hod_close"] = (gc > prev_hod).astype(np.float64)
        grp["dist_prev_hod_pct"] = _safe_div(gc - prev_hod, np.maximum(np.abs(prev_hod), 1e-6))

        # break_pm_high: high and close versions (pre_market_high is scalar per day)
        gpmh = grp["pre_market_high"].values.astype(np.float64) if "pre_market_high" in grp.columns else gh.copy()
        grp["break_pm_high"] = (gc > gpmh).astype(np.float64)
        grp["high_break_pm_high"] = (gh > gpmh).astype(np.float64)

        # day_open: first candle open of the day (correct reference for gap_filled)
        day_open = go[0]

        # gap_filled: price crossed back through day open (corrected)
        if "gap_pct" in grp.columns:
            gap = grp["gap_pct"].values.astype(np.float64)
            grp["gap_filled"] = ((gap > 0) & (gc < day_open) | (gap < 0) & (gc > day_open)).astype(np.float64)
        else:
            grp["gap_filled"] = 0.0

        # dist_gap → dist_day_open: distance to day open (more interpretable)
        grp["dist_gap"] = _safe_div(gc - day_open, np.maximum(np.abs(day_open), 1e-6))
        grp["dist_day_open"] = grp["dist_gap"]
        grp["close_vs_day_open"] = grp["dist_gap"]

        # max_high_last_5_excl_current, break_high_5: rupture of recent 5-bar high
        max_high_5 = np.zeros(len(gh))
        for i in range(1, len(gh)):
            start = max(0, i - 5)
            max_high_5[i] = np.max(gh[start:i])
        grp["max_high_last_5_excl_current"] = max_high_5
        grp["break_high_5"] = (gh > max_high_5).astype(np.float64)

        # Volume features
        vol_mean20 = _rolling_mean(gv, 20)
        grp["volume_rel"] = _safe_div(gv, np.maximum(vol_mean20, 1.0))
        grp["volume_spike"] = (grp["volume_rel"].values > 3.0).astype(np.float64)

        vol_rel_prev = np.roll(grp["volume_rel"].values, 1)
        vol_rel_prev[0] = grp["volume_rel"].values[0]
        grp["volume_acceleration"] = grp["volume_rel"].values - vol_rel_prev

        # Cumulative volume ratio (cumvol / mean daily vol estimated from first 60 candles)
        cum_vol = np.cumsum(gv)
        daily_vol_est = np.maximum(vol_mean20 * len(grp), 1.0)
        grp["cumulative_volume_ratio"] = _safe_div(cum_vol, daily_vol_est)

        # Dollar volume relative
        dv = gc * gv
        dv_mean20 = _rolling_mean(dv, 20)
        grp["relative_dollar_volume"] = _safe_div(dv, np.maximum(dv_mean20, 1.0))

        # OBV slope (5-period)
        obv = _obv(gc, gv)
        obv_5 = pd.Series(obv).rolling(5, min_periods=1).apply(
            lambda x: np.polyfit(np.arange(len(x)), x, 1)[0] if len(x) > 1 else 0, raw=True
        ).fillna(0).values
        grp["obv_slope_5"] = obv_5

        # VPT (Volume Price Trend)
        returns = np.diff(gc, prepend=gc[0]) / np.maximum(np.abs(np.roll(gc, 1)), 1e-6)
        returns[0] = 0
        grp["volume_price_trend"] = np.cumsum(returns * gv)

        # RSI
        grp["rsi"] = _rsi(gc, 14)

        # Rate of Change at multiple periods
        for p in [3, 5, 10, 20]:
            shifted = np.roll(gc, p)
            shifted[:p] = gc[:p]
            grp[f"roc_{p}"] = _safe_div(gc - shifted, np.maximum(np.abs(shifted), 1e-6))

        # Return lags
        for lag in [1, 2, 3]:
            prev = np.roll(gc, lag)
            prev[:lag] = gc[:lag]
            grp[f"return_lag_{lag}"] = _safe_div(gc - prev, np.maximum(np.abs(prev), 1e-6))

        # Momentum (mom_5, mom_10)
        for p in [5, 10]:
            shifted = np.roll(gc, p)
            shifted[:p] = gc[:p]
            grp[f"mom_{p}"] = gc - shifted

        # Momentum acceleration
        grp["momentum_acceleration"] = grp["mom_5"].values - grp["mom_10"].values

        # Volatility 15m (std of returns over 15 bars)
        rets_1 = np.diff(gc, prepend=gc[0]) / np.maximum(np.abs(np.roll(gc, 1)), 1e-6)
        rets_1[0] = 0
        grp["volatility_15m"] = _rolling_std(rets_1, 15)

        # Volatility ratio: recent vol vs overall ATR
        grp["volatility_ratio"] = _safe_div(grp["volatility_15m"].values, np.maximum(gatr / np.maximum(gc, 1e-6), 1e-8))

        # Consecutive green/red candles
        is_green = (grp["close"].values > grp["open"].values)
        grp["consecutive_green"] = _consecutive_count(is_green)
        grp["consecutive_red"] = _consecutive_count(~is_green)

        # Consolidation score: std(close[-5:]) / ATR
        close_std5 = _rolling_std(gc, 5)
        grp["consolidation_score"] = _safe_div(close_std5, np.maximum(gatr, 1e-6))

        # VWAP cross up (crossed from below to above in this candle)
        gvwap = grp["vwap"].values.astype(np.float64) if "vwap" in grp.columns else gc.copy()
        prev_close = np.roll(gc, 1)
        prev_close[0] = gc[0]
        grp["vwap_cross_up"] = ((prev_close <= gvwap) & (gc > gvwap)).astype(np.float64)

        # Float rotation (cumulative volume / shares outstanding) — may be 0 if no data
        if "shares_outstanding" in grp.columns:
            so = grp["shares_outstanding"].values.astype(np.float64)
            so = np.where((so > 0) & np.isfinite(so), so, np.nan)
            grp["float_rotation"] = _safe_div(cum_vol, np.where(np.isnan(so), 1e18, so))
        else:
            grp["float_rotation"] = 0.0

        # Relative range (current bar range / avg range 20)
        bar_range = grp["high"].values - grp["low"].values
        avg_range_20 = _rolling_mean(bar_range, 20)
        grp["relative_range"] = _safe_div(bar_range, np.maximum(avg_range_20, 1e-6))

        # Momentum divergence: price momentum vs volume momentum (causal: rolling std)
        price_mom_5 = grp["mom_5"].values
        vol_mom_5 = gv - np.roll(gv, 5)
        vol_mom_5[:5] = 0
        pm_roll_std = _rolling_std(price_mom_5, 20)
        vm_roll_std = _rolling_std(vol_mom_5, 20)
        pm_z = _safe_div(price_mom_5, np.maximum(pm_roll_std, 1e-8))
        vm_z = _safe_div(vol_mom_5, np.maximum(vm_roll_std, 1e-8))
        grp["momentum_divergence"] = pm_z - vm_z

        grouped_frames.append(grp)

    result = pd.concat(grouped_frames, ignore_index=True) if grouped_frames else df
    return result


# ---------------------------------------------------------------------------
# Feature set definitions for the experiment grid
# ---------------------------------------------------------------------------

# Set A: base features only (from the 31-col CSV, excluding IDs/labels)
FEATURE_SET_A = [
    "candle_idx", "open", "high", "low", "close", "volume",
    "atr", "vwap", "high_of_day", "low_of_day",
    "change_pct_at_candle", "ema9", "ema20",
    "pre_market_high", "shares_outstanding", "market_cap",
    "gap_pct", "premarket_volume",
    "momentum_acumulado", "change_1m", "change_5m", "change_10m",
    "minutes_since_hod",
]

# Set B: base + enriched features (matching the existing 52-col model)
FEATURE_SET_B = FEATURE_SET_A + [
    "volume_rel", "dist_vwap_pct", "atr_rel", "minute_of_day", "rsi",
    "volatility_15m", "mom_5", "mom_10",
    "return_lag_1", "return_lag_2", "return_lag_3",
    "dist_hod_pct", "dist_lod_pct", "dist_pm_high",
    "break_hod", "break_pm_high", "range_expansion",
    "float_rotation", "dollar_volume", "relative_dollar_volume",
    "volume_spike", "vwap_cross_up", "dist_ema9", "dist_ema20",
    "momentum_acceleration", "is_open", "is_midday", "is_power_hour",
    "dist_gap", "relative_range",
]

# Set C: base + price action (candlestick patterns + key distances)
FEATURE_SET_C = FEATURE_SET_A + [
    "body_pct", "upper_wick_pct", "lower_wick_pct", "is_green",
    "consecutive_green", "consecutive_red", "bar_range_vs_atr",
    "dist_vwap_pct", "dist_hod_pct", "dist_ema9", "dist_ema20",
    "break_hod", "pct_of_day_range",
]

# Set D: ALL features (~70)
FEATURE_SET_D = FEATURE_SET_B + [
    "body_pct", "upper_wick_pct", "lower_wick_pct", "is_green",
    "consecutive_green", "consecutive_red", "bar_range_vs_atr",
    "pct_of_day_range", "spread_estimate", "dist_to_round_number",
    "gap_filled", "volume_acceleration", "cumulative_volume_ratio",
    "obv_slope_5", "volume_price_trend",
    "roc_3", "roc_5", "roc_10", "roc_20",
    "volatility_ratio", "consolidation_score", "momentum_divergence",
    "is_premarket", "is_first_30min", "is_last_hour",
    "time_since_open_min",
]

# Set E: determined dynamically (top N by importance from best model in set D)
# Will be computed at runtime

# Set F: only price action + volume + time (no fundamentals)
FEATURE_SET_F = [
    "candle_idx", "open", "high", "low", "close", "volume",
    "atr", "vwap", "high_of_day", "low_of_day",
    "ema9", "ema20", "change_pct_at_candle",
    "momentum_acumulado", "change_1m", "change_5m", "change_10m",
    "minutes_since_hod",
    "body_pct", "upper_wick_pct", "lower_wick_pct", "is_green",
    "consecutive_green", "consecutive_red", "bar_range_vs_atr",
    "volume_rel", "volume_spike", "volume_acceleration",
    "rsi", "roc_5", "roc_10",
    "dist_vwap_pct", "dist_hod_pct", "dist_ema9", "dist_ema20",
    "break_hod", "pct_of_day_range",
    "minute_of_day", "is_premarket", "is_first_30min", "is_open",
    "is_power_hour",
    "volatility_15m", "mom_5", "mom_10",
    "return_lag_1", "return_lag_2", "return_lag_3",
]

# Remove duplicates while preserving order
for _name in ["FEATURE_SET_B", "FEATURE_SET_C", "FEATURE_SET_D", "FEATURE_SET_F"]:
    _lst = globals()[_name]
    _seen = set()
    _deduped = []
    for _f in _lst:
        if _f not in _seen:
            _seen.add(_f)
            _deduped.append(_f)
    globals()[_name] = _deduped

# D_clean: features causales, menos ruido, alineadas con momentum intradía
FEATURE_SET_D_CLEAN = [
    "candle_idx", "open", "high", "low", "close", "volume",
    "atr", "vwap", "ema9", "ema20", "high_of_day", "low_of_day",
    "pre_market_high", "shares_outstanding", "market_cap",
    "gap_pct", "premarket_volume",
    "change_pct_at_candle", "change_1m", "change_5m", "change_10m",
    "minutes_since_hod",
    "minute_of_day", "time_since_open_min",
    "is_premarket", "is_first_30min", "is_open", "is_midday", "is_power_hour",
    "body_pct", "upper_wick_pct", "lower_wick_pct", "is_green",
    "bar_range_vs_atr",
    "dist_vwap_pct", "dist_hod_pct", "dist_lod_pct",
    "dist_ema9", "dist_ema20", "dist_pm_high",
    "atr_rel", "range_expansion", "pct_of_day_range",
    "dollar_volume", "volume_rel", "volume_spike", "volume_acceleration",
    "relative_dollar_volume", "float_rotation",
    "rsi", "roc_5", "roc_10", "return_lag_1", "return_lag_2",
    "mom_5", "mom_10", "momentum_acceleration",
    "volatility_15m", "volatility_ratio",
    "consecutive_green", "consecutive_red", "consolidation_score",
    "vwap_cross_up", "relative_range",
    "dist_prev_hod_pct", "break_prev_hod_high", "break_prev_hod_close",
    "dist_day_open", "close_vs_day_open", "break_high_5",
]

# D1: core momentum — retornos, volumen, distancias VWAP/EMA, volatilidad, time
FEATURE_SET_D1 = FEATURE_SET_A + [
    "minute_of_day", "time_since_open_min",
    "is_premarket", "is_first_30min", "is_open", "is_midday", "is_power_hour",
    "volume_rel", "volume_spike", "volume_acceleration",
    "dist_vwap_pct", "dist_ema9", "dist_ema20", "atr_rel",
    "rsi", "roc_5", "roc_10", "return_lag_1", "return_lag_2",
    "mom_5", "mom_10", "momentum_acceleration",
    "volatility_15m", "volatility_ratio",
]

# D2: breakout structure — distancia HOD previo, ruptura, range, compression, body/wicks
FEATURE_SET_D2 = FEATURE_SET_A + [
    "body_pct", "upper_wick_pct", "lower_wick_pct", "is_green",
    "bar_range_vs_atr", "range_expansion", "pct_of_day_range", "relative_range",
    "dist_hod_pct", "dist_prev_hod_pct",
    "break_prev_hod_high", "break_prev_hod_close", "break_high_5",
    "consolidation_score",
]

# D3: liquidity/context — dollar volume, float rotation, session flags
FEATURE_SET_D3 = FEATURE_SET_A + [
    "dollar_volume", "relative_dollar_volume", "float_rotation",
    "minute_of_day", "time_since_open_min",
    "is_premarket", "is_first_30min", "is_open", "is_midday", "is_power_hour",
]

# D_clean_extended: D_clean + bar_range_pct (alias spread_estimate)
FEATURE_SET_D_CLEAN_EXT = list(FEATURE_SET_D_CLEAN) + ["bar_range_pct"]

# Dedupe new sets
for _name in ["FEATURE_SET_D_CLEAN", "FEATURE_SET_D1", "FEATURE_SET_D2", "FEATURE_SET_D3", "FEATURE_SET_D_CLEAN_EXT"]:
    _lst = globals()[_name]
    _seen = set()
    _deduped = []
    for _f in _lst:
        if _f not in _seen:
            _seen.add(_f)
            _deduped.append(_f)
    globals()[_name] = _deduped

FEATURE_SETS = {
    "A_base": FEATURE_SET_A,
    "B_enriched": FEATURE_SET_B,
    "C_price_action": FEATURE_SET_C,
    "D_all": FEATURE_SET_D,
    "F_price_vol_time": FEATURE_SET_F,
    "D_clean": FEATURE_SET_D_CLEAN,
    "D1_core_momentum": FEATURE_SET_D1,
    "D2_breakout_structure": FEATURE_SET_D2,
    "D3_liquidity_context": FEATURE_SET_D3,
    "D_clean_ext": FEATURE_SET_D_CLEAN_EXT,
}
