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
# Tier 1 indicators (highest SHAP importance in literature)
# ---------------------------------------------------------------------------

def _stochastic(high: np.ndarray, low: np.ndarray, close: np.ndarray,
                k_period: int = 14, d_period: int = 3) -> tuple[np.ndarray, np.ndarray]:
    """Fast Stochastic Oscillator (%K and %D)."""
    n = len(close)
    k = np.full(n, 50.0)
    for i in range(k_period - 1, n):
        hh = np.max(high[i - k_period + 1:i + 1])
        ll = np.min(low[i - k_period + 1:i + 1])
        if hh - ll > 1e-8:
            k[i] = 100.0 * (close[i] - ll) / (hh - ll)
    d = pd.Series(k).rolling(d_period, min_periods=1).mean().fillna(50.0).values
    return k, d


def _cci(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 20) -> np.ndarray:
    """Commodity Channel Index (vectorized — no rolling apply lambda)."""
    tp = (high + low + close) / 3.0
    tp_series = pd.Series(tp)
    tp_sma = tp_series.rolling(period, min_periods=1).mean().values
    # Mean absolute deviation: approximate with rolling std * 0.7979 (for normal dist)
    # This avoids the extremely slow rolling().apply(lambda) on millions of rows
    tp_std = tp_series.rolling(period, min_periods=1).std().fillna(1e-8).values
    tp_mad = tp_std * 0.7979  # E[|X-μ|] ≈ σ * √(2/π) ≈ 0.7979σ for normal
    return _safe_div(tp - tp_sma, np.maximum(0.015 * tp_mad, 1e-8))


def _williams_r(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """Williams %R (ranges from -100 to 0)."""
    n = len(close)
    wr = np.full(n, -50.0)
    for i in range(period - 1, n):
        hh = np.max(high[i - period + 1:i + 1])
        ll = np.min(low[i - period + 1:i + 1])
        if hh - ll > 1e-8:
            wr[i] = -100.0 * (hh - close[i]) / (hh - ll)
    return wr


def _hull_ema(arr: np.ndarray, period: int) -> np.ndarray:
    """Hull Moving Average — more responsive than standard EMA."""
    half = max(1, period // 2)
    sqrt_p = max(1, int(np.sqrt(period)))
    ema_half = _ema(arr, half)
    ema_full = _ema(arr, period)
    hull_input = 2.0 * ema_half - ema_full
    return _ema(hull_input, sqrt_p)


def _bollinger_pct_b(close: np.ndarray, period: int = 20, num_std: float = 2.0) -> np.ndarray:
    """Bollinger %B — position of price within Bollinger Bands (0=lower, 1=upper)."""
    sma = pd.Series(close).rolling(period, min_periods=1).mean().values
    std = pd.Series(close).rolling(period, min_periods=1).std().fillna(1e-8).values
    upper = sma + num_std * std
    lower = sma - num_std * std
    band_width = upper - lower
    return _safe_div(close - lower, np.maximum(band_width, 1e-8))


def _adx(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """Average Directional Index — trend strength (0-100)."""
    n = len(close)
    if n < period + 1:
        return np.full(n, 25.0)

    # True Range
    prev_close = np.roll(close, 1)
    prev_close[0] = close[0]
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))

    # +DM, -DM
    up_move = high - np.roll(high, 1)
    down_move = np.roll(low, 1) - low
    up_move[0] = 0
    down_move[0] = 0
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

    # Smoothed with EMA
    atr = pd.Series(tr).ewm(span=period, adjust=False).mean().values
    plus_di = 100.0 * _safe_div(
        pd.Series(plus_dm).ewm(span=period, adjust=False).mean().values,
        np.maximum(atr, 1e-8)
    )
    minus_di = 100.0 * _safe_div(
        pd.Series(minus_dm).ewm(span=period, adjust=False).mean().values,
        np.maximum(atr, 1e-8)
    )

    dx = 100.0 * _safe_div(np.abs(plus_di - minus_di), np.maximum(plus_di + minus_di, 1e-8))
    adx = pd.Series(dx).ewm(span=period, adjust=False).mean().fillna(25.0).values
    return np.where(np.isfinite(adx), adx, 25.0)


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

        # ── V2 new features ─────────────────────────────────────────────

        # Return acceleration (change in momentum direction)
        grp["return_accel_1m"] = grp["return_lag_1"].values - grp["return_lag_2"].values if "return_lag_1" in grp.columns else np.zeros(len(grp))
        grp["return_accel_5m"] = grp["roc_5"].values - grp["roc_10"].values if "roc_5" in grp.columns else np.zeros(len(grp))

        # Move strength vs volatility (z-score of 5m move)
        vol_15m = grp["volatility_15m"].values if "volatility_15m" in grp.columns else np.ones(len(grp)) * 1e-6
        chg_5m = grp["roc_5"].values if "roc_5" in grp.columns else np.zeros(len(grp))
        grp["move_vs_vol"] = _safe_div(chg_5m, np.maximum(vol_15m, 1e-6))

        rolling_std_5m = _rolling_std(rets_1, 5)
        grp["z_score_5m"] = _safe_div(chg_5m, np.maximum(rolling_std_5m, 1e-6))

        # Distance to recent 5-bar high/low (not day high, recent structure)
        min_low_5 = np.zeros(len(gc))
        gl = grp["low"].values.astype(np.float64)
        for i in range(len(gc)):
            start = max(0, i - 4)
            min_low_5[i] = np.min(gl[start:i + 1])
        grp["dist_high_5"] = _safe_div(gc - max_high_5, np.maximum(np.abs(max_high_5), 1e-6))
        grp["dist_low_5"] = _safe_div(gc - min_low_5, np.maximum(np.abs(min_low_5), 1e-6))

        # Buy volume ratio (proxy: sum vol of green candles / total vol, rolling 5)
        is_green_arr = (gc > go).astype(np.float64)
        buy_vol = gv * is_green_arr
        buy_vol_5 = _rolling_sum(buy_vol, 5)
        total_vol_5 = _rolling_sum(gv, 5)
        grp["buy_volume_ratio"] = _safe_div(buy_vol_5, np.maximum(total_vol_5, 1.0))

        # Volume trend: slope of volume_rel over last 5 bars
        vr = grp["volume_rel"].values if "volume_rel" in grp.columns else np.ones(len(grp))
        vr_slope = pd.Series(vr).rolling(5, min_periods=2).apply(
            lambda x: np.polyfit(np.arange(len(x)), x, 1)[0] if len(x) > 1 else 0, raw=True
        ).fillna(0).values
        grp["vol_trend_5"] = vr_slope

        # Volume concentration: % of cumulative vol in last 5 bars
        vol_5 = _rolling_sum(gv, 5)
        grp["vol_concentration_5"] = _safe_div(vol_5, np.maximum(cum_vol, 1.0))

        # Close position within candle range (0=at low, 1=at high)
        bar_range_raw = gh - gl
        grp["close_position"] = _safe_div(gc - gl, np.maximum(bar_range_raw, 1e-6))

        # Bar range as % of price
        grp["bar_range_pct"] = _safe_div(bar_range_raw, np.maximum(gc, 1e-6))

        # Bars above VWAP (count of last 5 bars where close > vwap)
        above_vwap = (gc > gvwap).astype(np.float64)
        grp["bars_above_vwap_5"] = _rolling_sum(above_vwap, 5)

        # EMA spread and its change (trend strength)
        d_ema9 = grp["dist_ema9"].values if "dist_ema9" in grp.columns else np.zeros(len(grp))
        d_ema20 = grp["dist_ema20"].values if "dist_ema20" in grp.columns else np.zeros(len(grp))
        ema_spread = d_ema9 - d_ema20
        grp["ema_spread"] = ema_spread
        ema_spread_prev = np.roll(ema_spread, 1)
        ema_spread_prev[0] = ema_spread[0]
        grp["ema_spread_change"] = ema_spread - ema_spread_prev

        # ── Tier 1 indicators (highest SHAP importance) ──────────────

        # Stochastic %K / %D (14,3)
        stoch_k, stoch_d = _stochastic(gh, gl, gc, 14, 3)
        grp["stochastic_k"] = stoch_k
        grp["stochastic_d"] = stoch_d

        # CCI (20)
        grp["cci"] = _cci(gh, gl, gc, 20)

        # Williams %R (14)
        grp["williams_r"] = _williams_r(gh, gl, gc, 14)

        # Hull EMA (7, 14)
        hull7 = _hull_ema(gc, 7)
        hull14 = _hull_ema(gc, 14)
        grp["hull_ema_7"] = hull7
        grp["hull_ema_14"] = hull14
        grp["dist_hull7"] = _safe_div(gc - hull7, np.maximum(np.abs(hull7), 1e-6))
        grp["dist_hull14"] = _safe_div(gc - hull14, np.maximum(np.abs(hull14), 1e-6))
        grp["hull_cross"] = ((hull7 > hull14) & (np.roll(hull7, 1) <= np.roll(hull14, 1))).astype(np.float64)

        # Bollinger %B (20, 2std)
        grp["bollinger_pct_b"] = _bollinger_pct_b(gc, 20, 2.0)

        # ADX (14) — trend strength
        grp["adx"] = _adx(gh, gl, gc, 14)

        # Multi-horizon momentum (longer ROC)
        for p in [20, 60]:
            shifted = np.roll(gc, p)
            shifted[:p] = gc[:p]
            grp[f"roc_{p}"] = _safe_div(gc - shifted, np.maximum(np.abs(shifted), 1e-6))

        # VWAP deviation z-score (rolling 20)
        vwap_dist = gc - gvwap
        vwap_dist_std = _rolling_std(vwap_dist, 20)
        grp["vwap_zscore"] = _safe_div(vwap_dist, np.maximum(vwap_dist_std, 1e-8))

        # ── Bearish / weakness features ──────────────────────────────

        # Selling pressure: vol in red candles / total vol (rolling 5)
        is_red_arr = (gc < go).astype(np.float64)
        sell_vol = gv * is_red_arr
        sell_vol_5 = _rolling_sum(sell_vol, 5)
        grp["selling_pressure"] = _safe_div(sell_vol_5, np.maximum(total_vol_5, 1.0))

        # Distance to recent 5-bar low
        min_low_5_arr = np.zeros(len(gc))
        for i in range(len(gc)):
            start = max(0, i - 4)
            min_low_5_arr[i] = np.min(gl[start:i + 1])
        grp["dist_recent_low_5"] = _safe_div(gc - min_low_5_arr, np.maximum(np.abs(min_low_5_arr), 1e-6))

        # Average lower wick size (rolling 5) — distribution signal
        lower_wicks = np.minimum(go, gc) - gl
        grp["lower_wicks_avg_5"] = _safe_div(_rolling_mean(lower_wicks, 5), np.maximum(gatr, 1e-6))

        # Break LOD: current low < previous low of day (use prev_lod, not current)
        running_min_l_lod = np.minimum.accumulate(gl)
        prev_lod_arr = np.zeros(len(gl))
        prev_lod_arr[0] = gl[0]
        prev_lod_arr[1:] = running_min_l_lod[:-1]
        grp["break_lod"] = (gl < prev_lod_arr).astype(np.float64)

        # Break previous LOD (rolling min of lows excluding current)
        running_min_l = np.minimum.accumulate(gl)
        prev_lod = np.zeros(len(gl))
        prev_lod[0] = gl[0]
        prev_lod[1:] = running_min_l[:-1]
        grp["break_prev_lod"] = (gl < prev_lod).astype(np.float64)
        grp["dist_prev_lod_pct"] = _safe_div(gc - prev_lod, np.maximum(np.abs(prev_lod), 1e-6))

        # Red volume ratio: vol in red candles / vol in green candles (rolling 10)
        red_vol_10 = _rolling_sum(sell_vol, 10)
        green_vol_10 = _rolling_sum(gv * (1 - is_red_arr), 10)
        grp["red_volume_ratio"] = _safe_div(red_vol_10, np.maximum(green_vol_10, 1.0))

        # Failed breakout: high > prev_hod but close < prev_hod (rejection)
        grp["failed_breakout"] = ((gh > prev_hod) & (gc < prev_hod)).astype(np.float64)

        # EMA bearish cross: EMA9 < EMA20
        gema9 = grp["ema9"].values.astype(np.float64) if "ema9" in grp.columns else gc.copy()
        gema20 = grp["ema20"].values.astype(np.float64) if "ema20" in grp.columns else gc.copy()
        grp["ema_bearish"] = (gema9 < gema20).astype(np.float64)

        # RSI oversold/overbought zones
        grsi = grp["rsi"].values if "rsi" in grp.columns else np.full(len(grp), 50.0)
        grp["rsi_overbought"] = (grsi > 70).astype(np.float64)
        grp["rsi_oversold"] = (grsi < 30).astype(np.float64)

        # Consecutive red with increasing volume (capitulation signal)
        red_inc_vol = is_red_arr * (gv > np.roll(gv, 1)).astype(np.float64)
        red_inc_vol[0] = 0
        grp["consec_red_inc_vol"] = _consecutive_count(red_inc_vol > 0)

        # Price below VWAP count (last 5 bars)
        below_vwap = (gc < gvwap).astype(np.float64)
        grp["bars_below_vwap_5"] = _rolling_sum(below_vwap, 5)

        # Gap vs ATR (gap strength relative to typical volatility)
        if "gap_pct" in grp.columns:
            gap_vals = grp["gap_pct"].values.astype(np.float64)
            atr_rel_vals = _safe_div(gatr, np.maximum(gc, 1e-6))
            grp["gap_vs_atr"] = _safe_div(gap_vals, np.maximum(atr_rel_vals, 1e-6))
        else:
            grp["gap_vs_atr"] = 0.0

        # Pre-market strength vs ATR
        pm_dist = grp["dist_pm_high"].values if "dist_pm_high" in grp.columns else np.zeros(len(grp))
        atr_rel_arr = grp["atr_rel"].values if "atr_rel" in grp.columns else np.ones(len(grp)) * 1e-6
        grp["pm_strength"] = _safe_div(np.abs(pm_dist), np.maximum(atr_rel_arr, 1e-6))

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

# ── V2 Feature Sets: ALL relative, NO absolute prices/volumes ─────────────

# V2_core: essential relative features only (~40 features)
FEATURE_SET_V2_CORE = [
    # Position in time
    "candle_idx", "minute_of_day", "time_since_open_min",
    "is_premarket", "is_first_30min", "is_open", "is_midday", "is_power_hour",
    # Price change & momentum (all %)
    "change_pct_at_candle", "change_1m", "change_5m", "change_10m",
    "roc_3", "roc_5", "roc_10",
    "return_lag_1", "return_lag_2", "return_lag_3",
    "return_accel_1m", "return_accel_5m",
    "momentum_acceleration",
    # Distances to key levels (all %)
    "dist_vwap_pct", "dist_hod_pct", "dist_lod_pct",
    "dist_ema9", "dist_ema20", "dist_pm_high",
    "dist_prev_hod_pct", "dist_day_open",
    "dist_high_5", "dist_low_5",
    # Volatility & structure (all relative)
    "atr_rel", "volatility_15m", "volatility_ratio",
    "rsi", "bar_range_vs_atr", "bar_range_pct",
    # Volume (all relative)
    "volume_rel", "volume_spike", "volume_acceleration",
    "buy_volume_ratio", "float_rotation",
]

# V2_full: core + all advanced relative features (~65 features)
FEATURE_SET_V2_FULL = FEATURE_SET_V2_CORE + [
    # Candle structure
    "body_pct", "upper_wick_pct", "lower_wick_pct", "is_green",
    "close_position", "range_expansion", "pct_of_day_range", "relative_range",
    # Breakout signals
    "break_hod", "break_prev_hod_high", "break_prev_hod_close", "break_high_5",
    "break_pm_high", "vwap_cross_up", "gap_filled",
    # Volume advanced
    "relative_dollar_volume", "cumulative_volume_ratio",
    "vol_trend_5", "vol_concentration_5",
    # Momentum advanced
    "move_vs_vol", "z_score_5m", "momentum_divergence",
    "consecutive_green", "consecutive_red", "consolidation_score",
    # EMA spread
    "ema_spread", "ema_spread_change",
    # Context
    "gap_vs_atr", "pm_strength",
    "bars_above_vwap_5",
    "minutes_since_hod",
    "gap_pct", "premarket_volume",
    "roc_20",
]

# V2_momentum: focused on momentum signals (~35 features)
FEATURE_SET_V2_MOMENTUM = [
    "candle_idx", "minute_of_day", "time_since_open_min",
    "is_first_30min", "is_open", "is_midday",
    "change_pct_at_candle", "change_1m", "change_5m", "change_10m",
    "roc_5", "roc_10", "return_lag_1", "return_lag_2",
    "return_accel_1m", "return_accel_5m", "momentum_acceleration",
    "move_vs_vol", "z_score_5m",
    "dist_vwap_pct", "dist_hod_pct", "dist_ema9", "dist_ema20",
    "dist_prev_hod_pct", "dist_high_5",
    "atr_rel", "volatility_15m", "rsi",
    "volume_rel", "volume_spike", "buy_volume_ratio", "vol_trend_5",
    "break_hod", "break_high_5", "ema_spread",
    "bar_range_vs_atr", "close_position",
]

# Dedupe V2 sets
for _name in ["FEATURE_SET_V2_CORE", "FEATURE_SET_V2_FULL", "FEATURE_SET_V2_MOMENTUM"]:
    _lst = globals()[_name]
    _seen = set()
    _deduped = []
    for _f in _lst:
        if _f not in _seen:
            _seen.add(_f)
            _deduped.append(_f)
    globals()[_name] = _deduped

# Bearish-specific features
BEARISH_FEATURES = [
    "selling_pressure", "dist_recent_low_5", "lower_wicks_avg_5",
    "break_lod", "break_prev_lod", "dist_prev_lod_pct",
    "red_volume_ratio", "failed_breakout",
    "ema_bearish", "rsi_overbought", "rsi_oversold",
    "consec_red_inc_vol", "bars_below_vwap_5",
]

# V2_full + bearish features (for both long and short signals)
FEATURE_SET_V2_FULL_BEAR = list(FEATURE_SET_V2_FULL) + BEARISH_FEATURES

# Bearish-focused set: features most relevant for detecting drops
FEATURE_SET_BEARISH = [
    "candle_idx", "minute_of_day", "time_since_open_min",
    "is_first_30min", "is_open", "is_midday",
    # Momentum (bearish signals)
    "change_pct_at_candle", "change_1m", "change_5m", "change_10m",
    "roc_5", "roc_10", "return_lag_1", "return_lag_2",
    "return_accel_1m", "return_accel_5m",
    # Distance features
    "dist_vwap_pct", "dist_hod_pct", "dist_lod_pct",
    "dist_ema9", "dist_ema20", "dist_prev_hod_pct",
    "dist_day_open", "dist_high_5", "dist_low_5",
    # Volatility
    "atr_rel", "volatility_15m", "rsi", "bar_range_vs_atr",
    # Volume
    "volume_rel", "volume_spike", "buy_volume_ratio",
    # Candle structure
    "body_pct", "upper_wick_pct", "lower_wick_pct", "is_green",
    "close_position", "consecutive_green", "consecutive_red",
    # Bearish-specific
    "selling_pressure", "dist_recent_low_5", "lower_wicks_avg_5",
    "break_lod", "break_prev_lod", "dist_prev_lod_pct",
    "red_volume_ratio", "failed_breakout",
    "ema_bearish", "rsi_overbought", "rsi_oversold",
    "consec_red_inc_vol", "bars_below_vwap_5",
]

# ── Tier 1 features (add to existing sets) ──
TIER1_FEATURES = [
    "stochastic_k", "stochastic_d",
    "cci", "williams_r",
    "hull_ema_7", "hull_ema_14", "dist_hull7", "dist_hull14", "hull_cross",
    "bollinger_pct_b", "adx",
    "roc_60", "vwap_zscore",
]

# V3: V2_full + Tier 1 indicators (best features from literature)
FEATURE_SET_V3 = list(FEATURE_SET_V2_FULL) + TIER1_FEATURES

# V3_bear: V3 + bearish features
FEATURE_SET_V3_BEAR = list(FEATURE_SET_V3) + BEARISH_FEATURES

# V3_tier1: only core + Tier 1 (fewer features, less noise)
FEATURE_SET_V3_TIER1 = list(FEATURE_SET_V2_CORE) + TIER1_FEATURES

# Dedupe all new sets
for _name in ["FEATURE_SET_V2_FULL_BEAR", "FEATURE_SET_BEARISH",
              "FEATURE_SET_V3", "FEATURE_SET_V3_BEAR", "FEATURE_SET_V3_TIER1"]:
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
    # V2: all-relative feature sets
    "V2_core": FEATURE_SET_V2_CORE,
    "V2_full": FEATURE_SET_V2_FULL,
    "V2_momentum": FEATURE_SET_V2_MOMENTUM,
    "V2_full_bear": FEATURE_SET_V2_FULL_BEAR,
    "bearish": FEATURE_SET_BEARISH,
    # V3: with Tier 1 indicators
    "V3": FEATURE_SET_V3,
    "V3_bear": FEATURE_SET_V3_BEAR,
    "V3_tier1": FEATURE_SET_V3_TIER1,
    # News features (require CSV with news columns from add-news-features.ts)
    "V2_full_news": FEATURE_SET_V2_FULL + [
        "has_news_premarket", "has_news_1h",
        "news_count_today", "news_count_premarket",
        "hours_since_news",
        "catalyst_strength",
        "catalyst_is_dilutive", "catalyst_is_earnings",
        "catalyst_is_fda", "catalyst_is_buyout",
    ],
    "D_clean_ext_news": FEATURE_SET_D_CLEAN_EXT + [
        "has_news_premarket", "has_news_1h",
        "news_count_today", "news_count_premarket",
        "hours_since_news",
        "catalyst_strength",
        "catalyst_is_dilutive", "catalyst_is_earnings",
        "catalyst_is_fda", "catalyst_is_buyout",
    ],
    "news_only": [
        "has_news_premarket", "has_news_1h",
        "news_count_today", "news_count_premarket",
        "hours_since_news",
        "catalyst_strength",
        "catalyst_is_dilutive", "catalyst_is_earnings",
        "catalyst_is_fda", "catalyst_is_buyout",
    ],
}
