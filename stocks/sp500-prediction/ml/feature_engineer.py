"""
Feature engineering para S&P 500 (SPY) intraday — 1 min candles.
Computa ~50 features optimizados para SPY day trading.
Agrupa por date para respetar boundaries diarias.

Features removidos vs v1 (ruido para SPY 1-min):
  - consecutive_green/red, body_pct, upper/lower_wick_pct, is_green
  - gap_filled, break_pm_high, consolidation_score
  - volume_price_trend (non-stationary cumulative)

Features agregados (top predictors segun la literatura):
  - VIX proxy (UVXY): level, change, rolling vol
  - Return autocorrelation (mean-reversion signal)
  - Multi-scale volatility (5m, 15m, 30m) + ratios
  - Parkinson volatility (OHLC-based, 5x more efficient)
  - Amihud illiquidity ratio
  - VWAP slope (institutional flow proxy)
  - Volume profile ratio (actual vs expected at this time of day)
  - Kyle's Lambda proxy (price impact per volume)
"""

import numpy as np
import pandas as pd

from ml.config import FEATURE_SETS  # noqa: F401


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_div(a, b, fill=0.0):
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.where(b != 0, a / b, fill)
    return np.where(np.isfinite(r), r, fill)


def _rolling_std(arr: np.ndarray, window: int) -> np.ndarray:
    return pd.Series(arr).rolling(window, min_periods=1).std().fillna(0).values


def _rolling_mean(arr: np.ndarray, window: int) -> np.ndarray:
    return pd.Series(arr).rolling(window, min_periods=1).mean().fillna(0).values


def _rsi(closes: np.ndarray, period: int = 14) -> np.ndarray:
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
    signs = np.sign(np.diff(closes, prepend=closes[0]))
    return np.cumsum(signs * volumes)


# ---------------------------------------------------------------------------
# Minute-of-day parser
# ---------------------------------------------------------------------------

_MARKET_OPEN_MIN = 9 * 60 + 30


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


# ---------------------------------------------------------------------------
# Main: add features grouped by date
# ---------------------------------------------------------------------------

def add_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add ~50 engineered features to SPY 1-min DataFrame.
    Groups by date to respect per-day boundaries.
    """
    df = df.copy()

    # Pre-compute minute_of_day
    if "candle_time_et" in df.columns:
        df["minute_of_day"] = df["candle_time_et"].apply(_parse_minute_of_day)
    else:
        df["minute_of_day"] = 0

    # Time-of-day session flags
    df["is_first_30min"] = ((df["minute_of_day"] >= _MARKET_OPEN_MIN) &
                             (df["minute_of_day"] < _MARKET_OPEN_MIN + 30)).astype(np.float64)
    df["is_open"] = ((df["minute_of_day"] >= _MARKET_OPEN_MIN) &
                      (df["minute_of_day"] < _MARKET_OPEN_MIN + 60)).astype(np.float64)
    df["is_midday"] = ((df["minute_of_day"] >= _MARKET_OPEN_MIN + 120) &
                        (df["minute_of_day"] < _MARKET_OPEN_MIN + 270)).astype(np.float64)
    df["is_power_hour"] = (df["minute_of_day"] >= 15 * 60).astype(np.float64)

    # ── Global features (don't need grouping) ─────────────────────────────
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

    # Distance features (all relative — no absolute prices)
    df["dist_vwap_pct"] = _safe_div(c - vwap, np.maximum(np.abs(vwap), 1e-6))
    df["dist_hod_pct"] = _safe_div(c - hod, np.maximum(np.abs(hod), 1e-6))
    df["dist_lod_pct"] = _safe_div(c - lod, np.maximum(np.abs(lod), 1e-6))
    df["dist_ema9"] = _safe_div(c - ema9, np.maximum(np.abs(ema9), 1e-6))
    df["dist_ema20"] = _safe_div(c - ema20, np.maximum(np.abs(ema20), 1e-6))
    df["atr_rel"] = _safe_div(atr, np.maximum(np.abs(c), 1e-6))

    # Range expansion (current bar range vs day range)
    day_range = np.maximum(hod - lod, 1e-6)
    df["range_expansion"] = _safe_div(h - lo, day_range)

    # Bar range vs ATR
    df["bar_range_vs_atr"] = _safe_div(h - lo, np.maximum(atr, 1e-6))

    # Dollar volume
    df["dollar_volume"] = c * v

    # ── VIX proxy features (UVXY) ─────────────────────────────────────────
    if "uvxy_close" in df.columns:
        uvxy_c = df["uvxy_close"].values.astype(np.float64)
        uvxy_chg = df["uvxy_change_pct"].values.astype(np.float64) if "uvxy_change_pct" in df.columns else np.zeros(len(df))
        uvxy_v = df["uvxy_volume"].values.astype(np.float64) if "uvxy_volume" in df.columns else np.zeros(len(df))

        df["vix_proxy_level"] = uvxy_c
        df["vix_proxy_change"] = uvxy_chg
        df["vix_proxy_volume_rel"] = _safe_div(uvxy_v, np.maximum(_rolling_mean(uvxy_v, 20) if len(uvxy_v) > 0 else np.ones(1), 1.0))
    else:
        df["vix_proxy_level"] = 0.0
        df["vix_proxy_change"] = 0.0
        df["vix_proxy_volume_rel"] = 0.0

    # ── Per-group features (rolling within date) ─────────────────────────
    grouped_frames = []

    for _date, grp in df.groupby("date", sort=False):
        grp = grp.copy()
        gc = grp["close"].values.astype(np.float64)
        gh = grp["high"].values.astype(np.float64)
        gl = grp["low"].values.astype(np.float64)
        go = grp["open"].values.astype(np.float64)
        gv = grp["volume"].values.astype(np.float64)
        gatr = grp["atr"].values.astype(np.float64) if "atr" in grp.columns else np.ones(len(grp))
        n = len(grp)

        # Returns (1-bar)
        prev_c = np.roll(gc, 1)
        prev_c[0] = gc[0]
        returns_1m = _safe_div(gc - prev_c, np.maximum(np.abs(prev_c), 1e-8))
        returns_1m[0] = 0

        # ── HOD breakout ──
        running_max_h = np.maximum.accumulate(gh)
        prev_hod = np.zeros(n)
        prev_hod[1:] = running_max_h[:-1]
        grp["break_hod"] = (gc > prev_hod).astype(np.float64)

        # ── Gap distance ──
        day_open = go[0]
        grp["dist_gap"] = _safe_div(gc - day_open, np.maximum(np.abs(day_open), 1e-6))

        # ── Volume features ──
        vol_mean20 = _rolling_mean(gv, 20)
        grp["volume_rel"] = _safe_div(gv, np.maximum(vol_mean20, 1.0))
        grp["volume_spike"] = (grp["volume_rel"].values > 3.0).astype(np.float64)

        dv = gc * gv
        dv_mean20 = _rolling_mean(dv, 20)
        grp["relative_dollar_volume"] = _safe_div(dv, np.maximum(dv_mean20, 1.0))

        # Volume profile ratio (actual vs expected at this minute of day)
        # Approximated as volume relative to session-average so far
        cum_vol = np.cumsum(gv)
        bar_idx = np.arange(1, n + 1, dtype=np.float64)
        avg_vol_so_far = cum_vol / bar_idx
        grp["volume_profile_ratio"] = _safe_div(gv, np.maximum(avg_vol_so_far, 1.0))

        # ── OBV slope (5-period) ──
        obv = _obv(gc, gv)
        obv_5 = pd.Series(obv).rolling(5, min_periods=1).apply(
            lambda x: np.polyfit(np.arange(len(x)), x, 1)[0] if len(x) > 1 else 0, raw=True
        ).fillna(0).values
        grp["obv_slope_5"] = obv_5

        # ── RSI ──
        grp["rsi"] = _rsi(gc, 14)

        # ── ROC ──
        for p in [3, 5, 10, 20]:
            shifted = np.roll(gc, p)
            shifted[:p] = gc[:p]
            grp[f"roc_{p}"] = _safe_div(gc - shifted, np.maximum(np.abs(shifted), 1e-6))

        # ── Return lags ──
        for lag in [1, 2, 3]:
            prev = np.roll(gc, lag)
            prev[:lag] = gc[:lag]
            grp[f"return_lag_{lag}"] = _safe_div(gc - prev, np.maximum(np.abs(prev), 1e-6))

        # ── Momentum ──
        for p in [5, 10]:
            shifted = np.roll(gc, p)
            shifted[:p] = gc[:p]
            grp[f"mom_{p}"] = gc - shifted
        grp["momentum_acceleration"] = grp["mom_5"].values - grp["mom_10"].values

        # ── VWAP cross up ──
        gvwap = grp["vwap"].values.astype(np.float64) if "vwap" in grp.columns else gc.copy()
        grp["vwap_cross_up"] = ((prev_c <= gvwap) & (gc > gvwap)).astype(np.float64)

        # ── Relative range ──
        bar_range = gh - gl
        avg_range_20 = _rolling_mean(bar_range, 20)
        grp["relative_range"] = _safe_div(bar_range, np.maximum(avg_range_20, 1e-6))

        # ── Z-score 20 ──
        sma20 = _rolling_mean(gc, 20)
        std20 = _rolling_std(gc, 20)
        grp["z_score_20"] = _safe_div(gc - sma20, np.maximum(std20, 1e-8))

        # ================================================================
        # NEW: Features that were missing (top predictors for SPY)
        # ================================================================

        # ── Return autocorrelation (rolling 20-bar, lag-1) ──
        # Negative = mean reversion, Positive = trending
        grp["return_autocorr_20"] = pd.Series(returns_1m).rolling(20, min_periods=5).apply(
            lambda x: pd.Series(x).autocorr(lag=1) if len(x) > 1 else 0, raw=False
        ).fillna(0).values

        # ── Multi-scale volatility ──
        grp["volatility_5m"] = _rolling_std(returns_1m, 5)
        grp["volatility_15m"] = _rolling_std(returns_1m, 15)
        grp["volatility_30m"] = _rolling_std(returns_1m, 30)

        # Volatility ratios (micro vs macro regime)
        grp["vol_ratio_5_30"] = _safe_div(
            grp["volatility_5m"].values,
            np.maximum(grp["volatility_30m"].values, 1e-10)
        )
        grp["vol_ratio_5_15"] = _safe_div(
            grp["volatility_5m"].values,
            np.maximum(grp["volatility_15m"].values, 1e-10)
        )

        # ── Parkinson volatility (OHLC-based, ~5x more efficient than close-to-close) ──
        log_hl = np.log(np.maximum(gh, 1e-8) / np.maximum(gl, 1e-8))
        parkinson_raw = log_hl ** 2 / (4 * np.log(2))
        grp["parkinson_vol"] = np.sqrt(
            pd.Series(parkinson_raw).rolling(14, min_periods=1).mean().fillna(0).values
        )

        # ── Amihud illiquidity ratio ──
        dollar_vol = np.maximum(gc * gv, 1.0)
        amihud = _safe_div(np.abs(returns_1m), dollar_vol)
        grp["amihud_illiquidity"] = _rolling_mean(amihud, 20)

        # ── Kyle's Lambda proxy (price impact per unit volume) ──
        # Rolling regression slope of |return| on volume (20-bar window)
        abs_ret = np.abs(returns_1m)
        kyle_lambda = pd.Series(abs_ret).rolling(20, min_periods=5).corr(
            pd.Series(gv)
        ).fillna(0).values
        grp["kyle_lambda"] = kyle_lambda

        # ── VWAP slope (institutional flow direction, 10-bar) ──
        grp["vwap_slope"] = pd.Series(gvwap).rolling(10, min_periods=2).apply(
            lambda x: np.polyfit(np.arange(len(x)), x, 1)[0] if len(x) > 1 else 0, raw=True
        ).fillna(0).values
        # Normalize by price level
        grp["vwap_slope_norm"] = _safe_div(grp["vwap_slope"].values, np.maximum(gc, 1e-6))

        # ── SPY-UVXY correlation (rolling 20-bar) ──
        if "uvxy_close" in grp.columns:
            uvxy_gc = grp["uvxy_close"].values.astype(np.float64)
            uvxy_prev = np.roll(uvxy_gc, 1)
            uvxy_prev[0] = uvxy_gc[0]
            uvxy_ret = _safe_div(uvxy_gc - uvxy_prev, np.maximum(np.abs(uvxy_prev), 1e-8))
            uvxy_ret[0] = 0

            grp["spy_uvxy_corr_20"] = pd.Series(returns_1m).rolling(20, min_periods=5).corr(
                pd.Series(uvxy_ret)
            ).fillna(0).values

            # UVXY 5m change (short-term fear spike)
            uvxy_5 = np.roll(uvxy_gc, 5)
            uvxy_5[:5] = uvxy_gc[:5]
            grp["uvxy_change_5m"] = _safe_div(uvxy_gc - uvxy_5, np.maximum(np.abs(uvxy_5), 1e-8))

            # UVXY RSI (fear momentum)
            grp["uvxy_rsi"] = _rsi(uvxy_gc, 14)
        else:
            grp["spy_uvxy_corr_20"] = 0.0
            grp["uvxy_change_5m"] = 0.0
            grp["uvxy_rsi"] = 50.0

        grouped_frames.append(grp)

    df = pd.concat(grouped_frames, axis=0)

    # Fill NaN/Inf
    numeric_cols = df.select_dtypes(include=[np.number]).columns
    df[numeric_cols] = df[numeric_cols].replace([np.inf, -np.inf], np.nan)
    df[numeric_cols] = df[numeric_cols].fillna(0)

    return df
