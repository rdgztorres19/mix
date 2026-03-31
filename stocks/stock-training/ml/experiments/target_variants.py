"""
Improved target variants for momentum stocks.
- Keeps existing targets
- Fixes invalid horizon handling
- Fixes ambiguous intrabar TP/SL handling
- Adds stronger momentum-oriented targets
- Returns both targets and valid masks
"""

from __future__ import annotations

import numpy as np
import pandas as pd


# ============================================================================
# Basic helpers
# ============================================================================

def _multiclass(arr: np.ndarray, threshold: float) -> np.ndarray:
    out = np.zeros(len(arr), dtype=np.int32)
    out[arr > threshold] = 1
    out[arr < -threshold] = -1
    return out


def _binary(arr: np.ndarray, threshold: float) -> np.ndarray:
    return (arr > threshold).astype(np.int32)


def _safe_div(a, b, fill=0.0):
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.where(np.abs(b) > 1e-12, a / b, fill)
    return np.where(np.isfinite(r), r, fill)


# ============================================================================
# Path simulation
# ============================================================================

def _simulate_first_touch(
    o: np.ndarray,
    h: np.ndarray,
    lo: np.ndarray,
    c: np.ndarray,
    prev_close: float,
    level_up: float,
    level_down: float,
) -> int:
    """
    Returns:
      1  -> up barrier hit first
      0  -> down barrier hit first
      -1 -> ambiguous / invalid
    """
    n = len(o)

    for j in range(n):
        open_j, high_j, low_j, close_j = o[j], h[j], lo[j], c[j]

        # Gap from prev_close to current open
        if prev_close < open_j:
            crossed_up = prev_close < level_up <= open_j
            crossed_down = prev_close < level_down <= open_j
            if crossed_up and crossed_down:
                return -1
            if crossed_up:
                return 1
            if crossed_down:
                return 0

        elif prev_close > open_j:
            crossed_up = open_j <= level_up < prev_close
            crossed_down = open_j <= level_down < prev_close
            if crossed_up and crossed_down:
                return -1
            if crossed_up:
                return 1
            if crossed_down:
                return 0

        touch_up = high_j >= level_up
        touch_down = low_j <= level_down

        if touch_up and touch_down:
            return -1  # ambiguous intrabar ordering

        if touch_up:
            return 1
        if touch_down:
            return 0

        prev_close = close_j

    return 0


# ============================================================================
# Future excursion helpers
# ============================================================================

def _future_max_return(df: pd.DataFrame, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """
    max(high[t+1:t+horizon]) vs close[t]
    returns: values, valid_mask
    """
    required = ["high", "close", "symbol", "date"]
    n_total = len(df)
    out = np.full(n_total, np.nan, dtype=np.float64)
    valid = np.zeros(n_total, dtype=bool)

    if not all(col in df.columns for col in required):
        return out, valid

    for (_sym, _date), grp in df.groupby(["symbol", "date"], sort=False):
        idx = grp.index.values
        high = grp["high"].values.astype(np.float64)
        close = grp["close"].values.astype(np.float64)
        n = len(grp)

        for i in range(n):
            if i + horizon >= n:
                continue
            if close[i] <= 0:
                continue
            max_high = np.max(high[i + 1 : i + horizon + 1])
            out[idx[i]] = (max_high - close[i]) / close[i]
            valid[idx[i]] = True

    return out, valid


def _future_min_return(df: pd.DataFrame, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """
    min(low[t+1:t+horizon]) vs close[t]
    returns: values, valid_mask
    """
    required = ["low", "close", "symbol", "date"]
    n_total = len(df)
    out = np.full(n_total, np.nan, dtype=np.float64)
    valid = np.zeros(n_total, dtype=bool)

    if not all(col in df.columns for col in required):
        return out, valid

    for (_sym, _date), grp in df.groupby(["symbol", "date"], sort=False):
        idx = grp.index.values
        low = grp["low"].values.astype(np.float64)
        close = grp["close"].values.astype(np.float64)
        n = len(grp)

        for i in range(n):
            if i + horizon >= n:
                continue
            if close[i] <= 0:
                continue
            min_low = np.min(low[i + 1 : i + horizon + 1])
            out[idx[i]] = (min_low - close[i]) / close[i]
            valid[idx[i]] = True

    return out, valid


def _future_close_return(df: pd.DataFrame, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    required = ["close", "symbol", "date"]
    n_total = len(df)
    out = np.full(n_total, np.nan, dtype=np.float64)
    valid = np.zeros(n_total, dtype=bool)

    if not all(col in df.columns for col in required):
        return out, valid

    for (_sym, _date), grp in df.groupby(["symbol", "date"], sort=False):
        idx = grp.index.values
        close = grp["close"].values.astype(np.float64)
        n = len(grp)

        for i in range(n):
            if i + horizon >= n:
                continue
            if close[i] <= 0:
                continue
            out[idx[i]] = (close[i + horizon] - close[i]) / close[i]
            valid[idx[i]] = True

    return out, valid


def _future_break_hod_followthrough(
    df: pd.DataFrame,
    horizon: int,
    follow_through_pct: float,
) -> tuple[np.ndarray, np.ndarray]:
    """
    1 if future price breaks current HOD and then reaches +follow_through_pct vs close[t].
    """
    required = ["high", "close", "high_of_day", "symbol", "date"]
    n_total = len(df)
    out = np.full(n_total, np.nan, dtype=np.float64)
    valid = np.zeros(n_total, dtype=bool)

    if not all(col in df.columns for col in required):
        return out, valid

    for (_sym, _date), grp in df.groupby(["symbol", "date"], sort=False):
        idx = grp.index.values
        high = grp["high"].values.astype(np.float64)
        close = grp["close"].values.astype(np.float64)
        hod = grp["high_of_day"].values.astype(np.float64)
        n = len(grp)

        for i in range(n):
            if i + horizon >= n:
                continue
            if close[i] <= 0:
                continue

            future_highs = high[i + 1 : i + horizon + 1]
            broke_hod = np.any(future_highs > hod[i])
            target_price = close[i] * (1.0 + follow_through_pct)
            follow_through = np.any(future_highs >= target_price)

            out[idx[i]] = 1.0 if (broke_hod and follow_through) else 0.0
            valid[idx[i]] = True

    return out, valid


# ============================================================================
# First-touch / triple barrier
# ============================================================================

def _hit_up_before_down(df: pd.DataFrame, threshold: float, horizon: int = 10) -> tuple[np.ndarray, np.ndarray]:
    """
    Binary target: 1 if +x% touched before -x% within next horizon candles, else 0.
    Ambiguous rows are invalid.
    """
    required = ["open", "high", "low", "close", "symbol", "date"]
    n_total = len(df)
    out = np.full(n_total, np.nan, dtype=np.float64)
    valid = np.zeros(n_total, dtype=bool)

    if not all(col in df.columns for col in required):
        return out, valid

    for (_sym, _date), grp in df.groupby(["symbol", "date"], sort=False):
        idx = grp.index.values
        n = len(grp)
        o = grp["open"].values.astype(np.float64)
        h = grp["high"].values.astype(np.float64)
        lo = grp["low"].values.astype(np.float64)
        c = grp["close"].values.astype(np.float64)

        for i in range(n):
            if i + horizon >= n:
                continue
            close_t = c[i]
            if close_t <= 0:
                continue

            level_up = close_t * (1.0 + threshold)
            level_down = close_t * (1.0 - threshold)

            result = _simulate_first_touch(
                o[i + 1 : i + horizon + 1],
                h[i + 1 : i + horizon + 1],
                lo[i + 1 : i + horizon + 1],
                c[i + 1 : i + horizon + 1],
                close_t,
                level_up,
                level_down,
            )

            if result == -1:
                continue

            out[idx[i]] = float(result)
            valid[idx[i]] = True

    return out, valid


def _hit_tp_before_sl(
    df: pd.DataFrame,
    take_profit: float,
    stop_loss: float,
    horizon: int = 10,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Binary target: 1 if +TP hit before -SL within next horizon candles, else 0.
    Ambiguous rows are invalid.
    """
    required = ["open", "high", "low", "close", "symbol", "date"]
    n_total = len(df)
    out = np.full(n_total, np.nan, dtype=np.float64)
    valid = np.zeros(n_total, dtype=bool)

    if not all(col in df.columns for col in required):
        return out, valid

    for (_sym, _date), grp in df.groupby(["symbol", "date"], sort=False):
        idx = grp.index.values
        n = len(grp)
        o = grp["open"].values.astype(np.float64)
        h = grp["high"].values.astype(np.float64)
        lo = grp["low"].values.astype(np.float64)
        c = grp["close"].values.astype(np.float64)

        for i in range(n):
            if i + horizon >= n:
                continue
            close_t = c[i]
            if close_t <= 0:
                continue

            level_up = close_t * (1.0 + take_profit)
            level_down = close_t * (1.0 - stop_loss)

            result = _simulate_first_touch(
                o[i + 1 : i + horizon + 1],
                h[i + 1 : i + horizon + 1],
                lo[i + 1 : i + horizon + 1],
                c[i + 1 : i + horizon + 1],
                close_t,
                level_up,
                level_down,
            )

            if result == -1:
                continue

            out[idx[i]] = float(result)
            valid[idx[i]] = True

    return out, valid


# ============================================================================
# Core builder
# ============================================================================

def compute_target_variants(df: pd.DataFrame) -> dict[str, dict[str, np.ndarray]]:
    """
    Returns:
      {
        target_name: {
          "y": np.ndarray[int32/float],
          "valid": np.ndarray[bool],
        }
      }
    """

    n = len(df)

    # Existing columns if present
    fr5m = df["future_return_5m"].values.astype(np.float64) if "future_return_5m" in df.columns else np.full(n, np.nan)
    valid_fr5m = np.isfinite(fr5m)

    original = df["target"].values.astype(np.float64) if "target" in df.columns else np.full(n, np.nan)
    valid_original = np.isfinite(original)

    brk_hod = df["target_break_hod_5m"].values.astype(np.float64) if "target_break_hod_5m" in df.columns else np.full(n, np.nan)
    valid_brk_hod = np.isfinite(brk_hod)

    mfr10m_existing = df["max_future_return_10m"].values.astype(np.float64) if "max_future_return_10m" in df.columns else np.full(n, np.nan)
    valid_mfr10m_existing = np.isfinite(mfr10m_existing)

    # Computed robust future stats
    mfr10m, valid_mfr10m = _future_max_return(df, 10)
    minfr10m, valid_minfr10m = _future_min_return(df, 10)
    fr10m, valid_fr10m = _future_close_return(df, 10)

    # Use provided max_future_return_10m if valid, else computed
    mfr10m_final = np.where(valid_mfr10m_existing, mfr10m_existing, mfr10m)
    valid_mfr10m_final = valid_mfr10m_existing | valid_mfr10m

    # Future reward/risk
    reward_10m = mfr10m_final
    risk_10m = np.abs(minfr10m)
    rr10m = _safe_div(reward_10m, np.maximum(risk_10m, 1e-8), fill=np.nan)
    valid_rr10m = valid_mfr10m_final & valid_minfr10m & np.isfinite(rr10m)

    # ATR-scaled max future return
    if "atr" in df.columns and "close" in df.columns:
        atr_rel = _safe_div(
            df["atr"].values.astype(np.float64),
            np.maximum(np.abs(df["close"].values.astype(np.float64)), 1e-8),
            fill=np.nan,
        )
        atr_rel_valid = np.isfinite(atr_rel) & (atr_rel > 0)
    else:
        atr_rel = np.full(n, np.nan)
        atr_rel_valid = np.zeros(n, dtype=bool)

    # First-touch / TB
    ft_1p0, valid_ft_1p0 = _hit_up_before_down(df, 0.010, 10)
    ft_1p5, valid_ft_1p5 = _hit_up_before_down(df, 0.015, 10)
    ft_2p0, valid_ft_2p0 = _hit_up_before_down(df, 0.020, 10)
    ft_2p5, valid_ft_2p5 = _hit_up_before_down(df, 0.025, 10)

    tb_1p5_0p5, valid_tb_1p5_0p5 = _hit_tp_before_sl(df, 0.015, 0.005, 10)
    tb_2p0_0p7, valid_tb_2p0_0p7 = _hit_tp_before_sl(df, 0.020, 0.007, 10)
    tb_2p5_1p0, valid_tb_2p5_1p0 = _hit_tp_before_sl(df, 0.025, 0.010, 10)

    tb_4p0_2p0, valid_tb_4p0_2p0 = _hit_tp_before_sl(df, 0.040, 0.020, 10)
    tb_5p0_2p5, valid_tb_5p0_2p5 = _hit_tp_before_sl(df, 0.050, 0.025, 10)
    tb_6p0_3p0, valid_tb_6p0_3p0 = _hit_tp_before_sl(df, 0.060, 0.030, 10)

    # New momentum targets
    follow_hod_0p5, valid_follow_hod_0p5 = _future_break_hod_followthrough(df, 10, 0.005)
    follow_hod_1p0, valid_follow_hod_1p0 = _future_break_hod_followthrough(df, 10, 0.010)

    opp_clean_1p5_0p5 = (
        (mfr10m_final >= 0.015) &
        (minfr10m > -0.005)
    ).astype(np.int32)
    valid_opp_clean_1p5_0p5 = valid_mfr10m_final & valid_minfr10m

    opp_clean_1p0_0p3 = (
        (mfr10m_final >= 0.010) &
        (minfr10m > -0.003)
    ).astype(np.int32)
    valid_opp_clean_1p0_0p3 = valid_mfr10m_final & valid_minfr10m

    mae_lt_0p5 = (minfr10m > -0.005).astype(np.int32)
    valid_mae_lt_0p5 = valid_minfr10m

    mae_lt_1p0 = (minfr10m > -0.010).astype(np.int32)
    valid_mae_lt_1p0 = valid_minfr10m

    rr_ge_2 = (rr10m >= 2.0).astype(np.int32)
    valid_rr_ge_2 = valid_rr10m

    rr_ge_3 = (rr10m >= 3.0).astype(np.int32)
    valid_rr_ge_3 = valid_rr10m

    mc_rr10m = np.zeros(n, dtype=np.int32)
    mc_rr10m[valid_rr10m & (rr10m >= 2.0)] = 1
    mc_rr10m[valid_rr10m & (rr10m < 1.0)] = -1

    bin_fr10m_1p0 = (fr10m >= 0.010).astype(np.int32)
    bin_fr10m_1p5 = (fr10m >= 0.015).astype(np.int32)

    if np.any(atr_rel_valid):
        bin_mfr10m_1atr = (mfr10m_final >= atr_rel).astype(np.int32)
        bin_mfr10m_1p5atr = (mfr10m_final >= 1.5 * atr_rel).astype(np.int32)
    else:
        bin_mfr10m_1atr = np.zeros(n, dtype=np.int32)
        bin_mfr10m_1p5atr = np.zeros(n, dtype=np.int32)

    valid_atr_scaled = valid_mfr10m_final & atr_rel_valid

    # ── V2 targets: longer horizons aligned with backtest strategy ────────

    # Triple barrier with longer horizons (match backtest lookAhead)
    tb_30m_4p0_2p0, valid_tb_30m_4p0_2p0 = _hit_tp_before_sl(df, 0.040, 0.020, 30)
    tb_60m_4p0_2p0, valid_tb_60m_4p0_2p0 = _hit_tp_before_sl(df, 0.040, 0.020, 60)
    tb_30m_3p0_1p5, valid_tb_30m_3p0_1p5 = _hit_tp_before_sl(df, 0.030, 0.015, 30)

    # Reward/Risk with longer horizon (30 candles)
    mfr30m, valid_mfr30m = _future_max_return(df, 30)
    minfr30m, valid_minfr30m = _future_min_return(df, 30)
    rr30m = _safe_div(mfr30m, np.maximum(np.abs(minfr30m), 1e-8), fill=np.nan)
    valid_rr30m = valid_mfr30m & valid_minfr30m & np.isfinite(rr30m)

    rr30m_ge_2 = (rr30m >= 2.0).astype(np.int32)
    valid_rr30m_ge_2 = valid_rr30m

    # Sustained momentum: close[t+10] > close[t+5] > close[t]
    fr5m_close, valid_fr5m_close = _future_close_return(df, 5)
    sustained_mom = np.zeros(n, dtype=np.int32)
    valid_sustained = valid_fr5m_close & valid_fr10m
    sustained_mom[valid_sustained & (fr5m_close > 0) & (fr10m > fr5m_close)] = 1

    # Clean entry: upside >= 3% AND drawdown < 1.5% in 10 candles
    clean_entry_10m = ((mfr10m_final >= 0.030) & (minfr10m > -0.015)).astype(np.int32)
    valid_clean_entry_10m = valid_mfr10m_final & valid_minfr10m

    # No drawdown + good upside in 30 candles
    clean_entry_30m = ((mfr30m >= 0.030) & (minfr30m > -0.015)).astype(np.int32)
    valid_clean_entry_30m = valid_mfr30m & valid_minfr30m

    # ── Bearish targets ──────────────────────────────────────────────────
    # Drop: min(low) falls X% below close within horizon
    drop_2p0_10m = (minfr10m <= -0.020).astype(np.int32)
    drop_4p0_10m = (minfr10m <= -0.040).astype(np.int32)
    drop_2p0_30m, valid_drop_2p0_30m = np.zeros(n, dtype=np.int32), valid_minfr30m
    drop_2p0_30m[valid_minfr30m] = (minfr30m[valid_minfr30m] <= -0.020).astype(np.int32)
    drop_4p0_30m = np.zeros(n, dtype=np.int32)
    drop_4p0_30m[valid_minfr30m] = (minfr30m[valid_minfr30m] <= -0.040).astype(np.int32)

    # SL hit before TP (inverse of existing tp_before_sl)
    sl_before_tp_4p0_2p0, valid_sl_bt = _hit_tp_before_sl(df, 0.040, 0.020, 10)
    sl_before_tp_4p0_2p0_inv = np.where(valid_sl_bt, 1 - np.nan_to_num(sl_before_tp_4p0_2p0, nan=0.0), 0).astype(np.int32)

    sl_before_tp_30m, valid_sl_bt_30m = _hit_tp_before_sl(df, 0.040, 0.020, 30)
    sl_before_tp_30m_inv = np.where(valid_sl_bt_30m, 1 - np.nan_to_num(sl_before_tp_30m, nan=0.0), 0).astype(np.int32)

    # Bearish R/R: downside risk >= 2x upside in 10 candles
    bearish_rr10m = _safe_div(np.abs(minfr10m), np.maximum(mfr10m_final, 1e-8), fill=np.nan)
    valid_bearish_rr10m = valid_mfr10m_final & valid_minfr10m & np.isfinite(bearish_rr10m)
    rr_bearish_ge_2 = np.zeros(n, dtype=np.int32)
    rr_bearish_ge_2[valid_bearish_rr10m] = (bearish_rr10m[valid_bearish_rr10m] >= 2.0).astype(np.int32)

    # Breakdown LOD: future low breaks current LOD
    if "low_of_day" in df.columns:
        lod_vals = df["low_of_day"].values.astype(np.float64)
        future_min_vals = np.full(n, np.nan)
        valid_breakdown = np.zeros(n, dtype=bool)
        for (_sym, _date), grp in df.groupby(["symbol", "date"], sort=False):
            idx = grp.index.values
            low = grp["low"].values.astype(np.float64)
            lod_grp = grp["low_of_day"].values.astype(np.float64)
            ng = len(grp)
            for i in range(ng):
                if i + 10 >= ng:
                    continue
                future_min = np.min(low[i + 1 : i + 11])
                future_min_vals[idx[i]] = future_min
                valid_breakdown[idx[i]] = True
        breakdown_lod = np.zeros(n, dtype=np.int32)
        breakdown_lod[valid_breakdown] = (future_min_vals[valid_breakdown] < lod_vals[valid_breakdown]).astype(np.int32)
    else:
        breakdown_lod = np.zeros(n, dtype=np.int32)
        valid_breakdown = np.zeros(n, dtype=bool)

    # Close return negative (price drops in next X candles)
    bin_fr10m_neg_1p0 = (fr10m <= -0.010).astype(np.int32)
    bin_fr10m_neg_2p0 = (fr10m <= -0.020).astype(np.int32)

    # Clean short: downside >= 3% and max adverse (upside) < 1.5% in 10 candles
    clean_short_10m = ((np.abs(minfr10m) >= 0.030) & (mfr10m_final < 0.015)).astype(np.int32)
    valid_clean_short_10m = valid_mfr10m_final & valid_minfr10m

    targets = {
        # Existing targets kept
        "mc_2p5": {"y": np.where(valid_original, original, 0).astype(np.int32), "valid": valid_original},
        "mc_2p0": {"y": _multiclass(np.nan_to_num(fr5m, nan=0.0), 0.02), "valid": valid_fr5m},
        "mc_1p5": {"y": _multiclass(np.nan_to_num(fr5m, nan=0.0), 0.015), "valid": valid_fr5m},

        "bin_fr5m_2p5": {"y": _binary(np.nan_to_num(fr5m, nan=0.0), 0.025), "valid": valid_fr5m},
        "bin_fr5m_2p0": {"y": _binary(np.nan_to_num(fr5m, nan=0.0), 0.020), "valid": valid_fr5m},
        "bin_fr5m_1p5": {"y": _binary(np.nan_to_num(fr5m, nan=0.0), 0.015), "valid": valid_fr5m},
        "bin_fr5m_1p0": {"y": _binary(np.nan_to_num(fr5m, nan=0.0), 0.010), "valid": valid_fr5m},

        "bin_mfr10m_2p5": {"y": _binary(np.nan_to_num(mfr10m_final, nan=0.0), 0.025), "valid": valid_mfr10m_final},
        "bin_mfr10m_2p0": {"y": _binary(np.nan_to_num(mfr10m_final, nan=0.0), 0.020), "valid": valid_mfr10m_final},
        "bin_mfr10m_1p5": {"y": _binary(np.nan_to_num(mfr10m_final, nan=0.0), 0.015), "valid": valid_mfr10m_final},
        "bin_mfr10m_1p0": {"y": _binary(np.nan_to_num(mfr10m_final, nan=0.0), 0.010), "valid": valid_mfr10m_final},

        "bin_break_hod": {"y": np.where(valid_brk_hod, brk_hod, 0).astype(np.int32), "valid": valid_brk_hod},

        "bin_first_touch_10m_2p5": {"y": np.nan_to_num(ft_2p5, nan=0.0).astype(np.int32), "valid": valid_ft_2p5},
        "bin_first_touch_10m_2p0": {"y": np.nan_to_num(ft_2p0, nan=0.0).astype(np.int32), "valid": valid_ft_2p0},
        "bin_first_touch_10m_1p5": {"y": np.nan_to_num(ft_1p5, nan=0.0).astype(np.int32), "valid": valid_ft_1p5},
        "bin_first_touch_10m_1p0": {"y": np.nan_to_num(ft_1p0, nan=0.0).astype(np.int32), "valid": valid_ft_1p0},

        "bin_tb10m_tp1p5_sl0p5": {"y": np.nan_to_num(tb_1p5_0p5, nan=0.0).astype(np.int32), "valid": valid_tb_1p5_0p5},
        "bin_tb10m_tp2p0_sl0p7": {"y": np.nan_to_num(tb_2p0_0p7, nan=0.0).astype(np.int32), "valid": valid_tb_2p0_0p7},
        "bin_tb10m_tp2p5_sl1p0": {"y": np.nan_to_num(tb_2p5_1p0, nan=0.0).astype(np.int32), "valid": valid_tb_2p5_1p0},

        "bin_tb10m_tp4p0_sl2p0": {"y": np.nan_to_num(tb_4p0_2p0, nan=0.0).astype(np.int32), "valid": valid_tb_4p0_2p0},
        "bin_tb10m_tp5p0_sl2p5": {"y": np.nan_to_num(tb_5p0_2p5, nan=0.0).astype(np.int32), "valid": valid_tb_5p0_2p5},
        "bin_tb10m_tp6p0_sl3p0": {"y": np.nan_to_num(tb_6p0_3p0, nan=0.0).astype(np.int32), "valid": valid_tb_6p0_3p0},

        # New strong momentum targets
        "bin_fr10m_1p0": {"y": bin_fr10m_1p0, "valid": valid_fr10m},
        "bin_fr10m_1p5": {"y": bin_fr10m_1p5, "valid": valid_fr10m},

        "bin_mae10m_lt_0p5": {"y": mae_lt_0p5, "valid": valid_mae_lt_0p5},
        "bin_mae10m_lt_1p0": {"y": mae_lt_1p0, "valid": valid_mae_lt_1p0},

        "bin_opportunity_clean_10m_1p5_0p5": {"y": opp_clean_1p5_0p5, "valid": valid_opp_clean_1p5_0p5},
        "bin_opportunity_clean_10m_1p0_0p3": {"y": opp_clean_1p0_0p3, "valid": valid_opp_clean_1p0_0p3},

        "bin_rr10m_ge_2": {"y": rr_ge_2, "valid": valid_rr_ge_2},
        "bin_rr10m_ge_3": {"y": rr_ge_3, "valid": valid_rr_ge_3},
        "mc_rr10m": {"y": mc_rr10m, "valid": valid_rr10m},

        "bin_follow_through_hod_10m_0p5": {"y": np.nan_to_num(follow_hod_0p5, nan=0.0).astype(np.int32), "valid": valid_follow_hod_0p5},
        "bin_follow_through_hod_10m_1p0": {"y": np.nan_to_num(follow_hod_1p0, nan=0.0).astype(np.int32), "valid": valid_follow_hod_1p0},

        "bin_mfr10m_1atr": {"y": bin_mfr10m_1atr, "valid": valid_atr_scaled},
        "bin_mfr10m_1p5atr": {"y": bin_mfr10m_1p5atr, "valid": valid_atr_scaled},

        # V2 targets: longer horizons aligned with backtest strategy
        "bin_tb30m_tp4p0_sl2p0": {"y": np.nan_to_num(tb_30m_4p0_2p0, nan=0.0).astype(np.int32), "valid": valid_tb_30m_4p0_2p0},
        "bin_tb60m_tp4p0_sl2p0": {"y": np.nan_to_num(tb_60m_4p0_2p0, nan=0.0).astype(np.int32), "valid": valid_tb_60m_4p0_2p0},
        "bin_tb30m_tp3p0_sl1p5": {"y": np.nan_to_num(tb_30m_3p0_1p5, nan=0.0).astype(np.int32), "valid": valid_tb_30m_3p0_1p5},
        "bin_rr30m_ge_2": {"y": rr30m_ge_2, "valid": valid_rr30m_ge_2},
        "bin_sustained_momentum_10m": {"y": sustained_mom, "valid": valid_sustained},
        "bin_clean_entry_10m": {"y": clean_entry_10m, "valid": valid_clean_entry_10m},
        "bin_clean_entry_30m": {"y": clean_entry_30m, "valid": valid_clean_entry_30m},

        # ── Bearish targets ──────────────────────────────────────────
        "bin_drop_2p0_10m": {"y": drop_2p0_10m, "valid": valid_minfr10m},
        "bin_drop_4p0_10m": {"y": drop_4p0_10m, "valid": valid_minfr10m},
        "bin_drop_2p0_30m": {"y": drop_2p0_30m, "valid": valid_drop_2p0_30m},
        "bin_drop_4p0_30m": {"y": drop_4p0_30m, "valid": valid_minfr30m},
        "bin_sl_before_tp_10m": {"y": sl_before_tp_4p0_2p0_inv, "valid": valid_sl_bt},
        "bin_sl_before_tp_30m": {"y": sl_before_tp_30m_inv, "valid": valid_sl_bt_30m},
        "bin_rr10m_bearish_ge_2": {"y": rr_bearish_ge_2, "valid": valid_bearish_rr10m},
        "bin_breakdown_lod_10m": {"y": breakdown_lod, "valid": valid_breakdown},
        "bin_fr10m_neg_1p0": {"y": bin_fr10m_neg_1p0, "valid": valid_fr10m},
        "bin_fr10m_neg_2p0": {"y": bin_fr10m_neg_2p0, "valid": valid_fr10m},
        "bin_clean_short_10m": {"y": clean_short_10m, "valid": valid_clean_short_10m},
    }

    return targets


TARGET_META = {
    "mc_2p5": (True, "Multiclass ±2.5% (original)"),
    "mc_2p0": (True, "Multiclass ±2.0% en 5m"),
    "mc_1p5": (True, "Multiclass ±1.5% en 5m"),

    "bin_fr5m_2p5": (False, "Close[t+5] > +2.5%"),
    "bin_fr5m_2p0": (False, "Close[t+5] > +2.0%"),
    "bin_fr5m_1p5": (False, "Close[t+5] > +1.5%"),
    "bin_fr5m_1p0": (False, "Close[t+5] > +1.0%"),

    "bin_mfr10m_2p5": (False, "Max high futuro 10m > +2.5%"),
    "bin_mfr10m_2p0": (False, "Max high futuro 10m > +2.0%"),
    "bin_mfr10m_1p5": (False, "Max high futuro 10m > +1.5%"),
    "bin_mfr10m_1p0": (False, "Max high futuro 10m > +1.0%"),

    "bin_break_hod": (False, "Rompe HOD en próximas 5 velas"),

    "bin_first_touch_10m_2p5": (False, "Toca +2.5% antes que -2.5%"),
    "bin_first_touch_10m_2p0": (False, "Toca +2.0% antes que -2.0%"),
    "bin_first_touch_10m_1p5": (False, "Toca +1.5% antes que -1.5%"),
    "bin_first_touch_10m_1p0": (False, "Toca +1.0% antes que -1.0%"),

    "bin_tb10m_tp1p5_sl0p5": (False, "TP +1.5% antes de SL -0.5%"),
    "bin_tb10m_tp2p0_sl0p7": (False, "TP +2.0% antes de SL -0.7%"),
    "bin_tb10m_tp2p5_sl1p0": (False, "TP +2.5% antes de SL -1.0%"),
    "bin_tb10m_tp4p0_sl2p0": (False, "TP +4.0% antes de SL -2.0%"),
    "bin_tb10m_tp5p0_sl2p5": (False, "TP +5.0% antes de SL -2.5%"),
    "bin_tb10m_tp6p0_sl3p0": (False, "TP +6.0% antes de SL -3.0%"),

    "bin_fr10m_1p0": (False, "Close[t+10] > +1.0%"),
    "bin_fr10m_1p5": (False, "Close[t+10] > +1.5%"),

    "bin_mae10m_lt_0p5": (False, "MAE 10m mayor que -0.5% no ocurre"),
    "bin_mae10m_lt_1p0": (False, "MAE 10m mayor que -1.0% no ocurre"),

    "bin_opportunity_clean_10m_1p5_0p5": (False, "Sube +1.5% sin caer más de -0.5%"),
    "bin_opportunity_clean_10m_1p0_0p3": (False, "Sube +1.0% sin caer más de -0.3%"),

    "bin_rr10m_ge_2": (False, "Reward/Risk futuro 10m >= 2"),
    "bin_rr10m_ge_3": (False, "Reward/Risk futuro 10m >= 3"),
    "mc_rr10m": (True, "Multiclass por reward/risk futuro"),

    "bin_follow_through_hod_10m_0p5": (False, "Rompe HOD y extiende +0.5%"),
    "bin_follow_through_hod_10m_1p0": (False, "Rompe HOD y extiende +1.0%"),

    "bin_mfr10m_1atr": (False, "Max high futuro 10m > 1x ATR"),
    "bin_mfr10m_1p5atr": (False, "Max high futuro 10m > 1.5x ATR"),

    # V2 targets
    "bin_tb30m_tp4p0_sl2p0": (False, "TP +4.0% antes SL -2.0% en 30 candles"),
    "bin_tb60m_tp4p0_sl2p0": (False, "TP +4.0% antes SL -2.0% en 60 candles"),
    "bin_tb30m_tp3p0_sl1p5": (False, "TP +3.0% antes SL -1.5% en 30 candles"),
    "bin_rr30m_ge_2": (False, "Reward/Risk futuro 30m >= 2"),
    "bin_sustained_momentum_10m": (False, "Momentum sostenido: close[t+10] > close[t+5] > close[t]"),
    "bin_clean_entry_10m": (False, "Upside >= 3% y drawdown < 1.5% en 10 candles"),
    "bin_clean_entry_30m": (False, "Upside >= 3% y drawdown < 1.5% en 30 candles"),

    # Bearish targets
    "bin_drop_2p0_10m": (False, "Min low cae >= -2% en 10 candles"),
    "bin_drop_4p0_10m": (False, "Min low cae >= -4% en 10 candles"),
    "bin_drop_2p0_30m": (False, "Min low cae >= -2% en 30 candles"),
    "bin_drop_4p0_30m": (False, "Min low cae >= -4% en 30 candles"),
    "bin_sl_before_tp_10m": (False, "SL -2% hit antes que TP +4% en 10 candles"),
    "bin_sl_before_tp_30m": (False, "SL -2% hit antes que TP +4% en 30 candles"),
    "bin_rr10m_bearish_ge_2": (False, "Risk/Reward bearish >= 2 en 10 candles"),
    "bin_breakdown_lod_10m": (False, "Rompe LOD en próximas 10 candles"),
    "bin_fr10m_neg_1p0": (False, "Close[t+10] cae >= -1%"),
    "bin_fr10m_neg_2p0": (False, "Close[t+10] cae >= -2%"),
    "bin_clean_short_10m": (False, "Caída >= 3% con max adverse (subida) < 1.5% en 10 candles"),
}