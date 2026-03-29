"""
Target variants para S&P 500 (SPY) intraday — 1 min candles.
IMPORTANTE: SPY se mueve ~0.05-0.3% por candle (vs 1-5% en small caps).
Los thresholds son 5-10x menores que en stock-training.

Cambios vs v1:
  REMOVIDOS (ruido / distribuciones triviales):
    - bin_fr5m_up, bin_fr10m_up (direction ~50/50, unpredictable)
    - mc_5m_010, mc_5m_020 (neutral class domina 70-80%)
    - bin_mae10m_lt_010, bin_mae10m_lt_020 (80-90% positive, trivial)
    - bin_tb10m_tp02_sl01 (too rare ~5-10%)
    - bin_tb30m_tp10_sl05, bin_tb60m_tp10_sl05 (too rare, only CPI/FOMC days)

  AGREGADOS (mejores para trading real):
    - Vol-scaled triple barrier (adapts to VIX regime)
    - Vol-scaled reward/risk
    - Metalabel-ready targets (to be used with base signals)

Formato: dict[str, dict[str, np.ndarray]] -> {"y": array, "valid": mask}
Agrupa por date para no cruzar boundaries de dias.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


# ============================================================================
# Helpers
# ============================================================================

def _safe_div(a, b, fill=0.0):
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.where(np.abs(b) > 1e-12, a / b, fill)
    return np.where(np.isfinite(r), r, fill)


def _binary(arr: np.ndarray, threshold: float) -> np.ndarray:
    return (arr > threshold).astype(np.int32)


# ============================================================================
# Path simulation (first-touch / triple barrier)
# ============================================================================

def _simulate_first_touch(
    o: np.ndarray, h: np.ndarray, lo: np.ndarray, c: np.ndarray,
    prev_close: float, level_up: float, level_down: float,
) -> int:
    """1=up barrier hit first, 0=down barrier hit first, -1=ambiguous."""
    for j in range(len(o)):
        touch_up = h[j] >= level_up
        touch_down = lo[j] <= level_down
        if touch_up and touch_down:
            return -1
        if touch_up:
            return 1
        if touch_down:
            return 0
        prev_close = c[j]
    return 0


# ============================================================================
# Per-group future excursion (respects date boundaries)
# ============================================================================

def _future_max_return(df: pd.DataFrame, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """max(high[t+1:t+horizon]) vs close[t], per date."""
    n_total = len(df)
    out = np.full(n_total, np.nan, dtype=np.float64)
    valid = np.zeros(n_total, dtype=bool)

    for _date, grp in df.groupby("date", sort=False):
        idx = grp.index.values
        high = grp["high"].values.astype(np.float64)
        close = grp["close"].values.astype(np.float64)
        n = len(grp)
        for i in range(n):
            if i + horizon >= n or close[i] <= 0:
                continue
            max_high = np.max(high[i + 1:i + horizon + 1])
            out[idx[i]] = (max_high - close[i]) / close[i]
            valid[idx[i]] = True
    return out, valid


def _future_min_return(df: pd.DataFrame, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """min(low[t+1:t+horizon]) vs close[t], per date."""
    n_total = len(df)
    out = np.full(n_total, np.nan, dtype=np.float64)
    valid = np.zeros(n_total, dtype=bool)

    for _date, grp in df.groupby("date", sort=False):
        idx = grp.index.values
        low = grp["low"].values.astype(np.float64)
        close = grp["close"].values.astype(np.float64)
        n = len(grp)
        for i in range(n):
            if i + horizon >= n or close[i] <= 0:
                continue
            min_low = np.min(low[i + 1:i + horizon + 1])
            out[idx[i]] = (min_low - close[i]) / close[i]
            valid[idx[i]] = True
    return out, valid


def _future_close_return(df: pd.DataFrame, horizon: int) -> tuple[np.ndarray, np.ndarray]:
    """close[t+horizon] vs close[t], per date."""
    n_total = len(df)
    out = np.full(n_total, np.nan, dtype=np.float64)
    valid = np.zeros(n_total, dtype=bool)

    for _date, grp in df.groupby("date", sort=False):
        idx = grp.index.values
        close = grp["close"].values.astype(np.float64)
        n = len(grp)
        for i in range(n):
            if i + horizon >= n or close[i] <= 0:
                continue
            out[idx[i]] = (close[i + horizon] - close[i]) / close[i]
            valid[idx[i]] = True
    return out, valid


def _hit_tp_before_sl(
    df: pd.DataFrame, take_profit: float, stop_loss: float, horizon: int = 10,
) -> tuple[np.ndarray, np.ndarray]:
    """TP hit before SL within horizon candles, per date."""
    n_total = len(df)
    out = np.full(n_total, np.nan, dtype=np.float64)
    valid = np.zeros(n_total, dtype=bool)

    for _date, grp in df.groupby("date", sort=False):
        idx = grp.index.values
        n = len(grp)
        o = grp["open"].values.astype(np.float64)
        h = grp["high"].values.astype(np.float64)
        lo = grp["low"].values.astype(np.float64)
        c = grp["close"].values.astype(np.float64)

        for i in range(n):
            if i + horizon >= n or c[i] <= 0:
                continue
            level_up = c[i] * (1.0 + take_profit)
            level_down = c[i] * (1.0 - stop_loss)
            result = _simulate_first_touch(
                o[i + 1:i + horizon + 1], h[i + 1:i + horizon + 1],
                lo[i + 1:i + horizon + 1], c[i + 1:i + horizon + 1],
                c[i], level_up, level_down,
            )
            if result == -1:
                continue
            out[idx[i]] = float(result)
            valid[idx[i]] = True
    return out, valid


# ============================================================================
# Vol-scaled triple barrier (NEW — adapts to VIX/volatility regime)
# ============================================================================

def _hit_tp_before_sl_volscaled(
    df: pd.DataFrame, tp_mult: float, sl_mult: float, horizon: int,
    vol_window: int = 15,
) -> tuple[np.ndarray, np.ndarray]:
    """
    TP/SL scaled by rolling realized volatility.
    tp_mult/sl_mult are multiples of rolling_std (e.g., 1.5x std for TP).
    This automatically adapts: wider barriers in high-vol, tighter in low-vol.
    """
    n_total = len(df)
    out = np.full(n_total, np.nan, dtype=np.float64)
    valid = np.zeros(n_total, dtype=bool)

    for _date, grp in df.groupby("date", sort=False):
        idx = grp.index.values
        n = len(grp)
        o = grp["open"].values.astype(np.float64)
        h = grp["high"].values.astype(np.float64)
        lo = grp["low"].values.astype(np.float64)
        c = grp["close"].values.astype(np.float64)

        # Rolling realized vol (1-bar returns std)
        rets = np.diff(c, prepend=c[0]) / np.maximum(np.abs(np.roll(c, 1)), 1e-8)
        rets[0] = 0
        vol = pd.Series(rets).rolling(vol_window, min_periods=5).std().fillna(0).values

        for i in range(n):
            if i + horizon >= n or c[i] <= 0 or vol[i] <= 1e-10:
                continue
            tp = tp_mult * vol[i]
            sl = sl_mult * vol[i]
            level_up = c[i] * (1.0 + tp)
            level_down = c[i] * (1.0 - sl)
            result = _simulate_first_touch(
                o[i + 1:i + horizon + 1], h[i + 1:i + horizon + 1],
                lo[i + 1:i + horizon + 1], c[i + 1:i + horizon + 1],
                c[i], level_up, level_down,
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
    """Compute all target variants for SPY intraday day trading."""

    n = len(df)

    # Existing columns from CSV (max/min future excursion)
    mfr10m = df["max_future_return_10m"].values.astype(np.float64) if "max_future_return_10m" in df.columns else np.full(n, np.nan)
    valid_mfr10m = np.isfinite(mfr10m)

    minfr10m = df["min_future_return_10m"].values.astype(np.float64) if "min_future_return_10m" in df.columns else np.full(n, np.nan)
    valid_minfr10m = np.isfinite(minfr10m)

    # Computed from OHLC (per-date) for 30m horizon
    mfr30m, valid_mfr30m = _future_max_return(df, 30)
    minfr30m, valid_minfr30m = _future_min_return(df, 30)

    # Reward/Risk 10m
    reward_10m = np.nan_to_num(mfr10m, nan=0.0)
    risk_10m = np.abs(np.nan_to_num(minfr10m, nan=0.0))
    rr10m = _safe_div(reward_10m, np.maximum(risk_10m, 1e-8), fill=np.nan)
    valid_rr10m = valid_mfr10m & valid_minfr10m & np.isfinite(rr10m)

    # Reward/Risk 30m
    rr30m = _safe_div(np.nan_to_num(mfr30m, nan=0.0), np.maximum(np.abs(np.nan_to_num(minfr30m, nan=0.0)), 1e-8), fill=np.nan)
    valid_rr30m = valid_mfr30m & valid_minfr30m & np.isfinite(rr30m)

    # ── Vol-scaled triple barrier (adapts to regime) ───────────────────

    # Conservative: 1.0x vol TP, 0.7x vol SL (2:1.4 ratio) — 10m horizon
    tb_vs10m_10_07, v_tb_vs10m_10_07 = _hit_tp_before_sl_volscaled(df, 1.0, 0.7, 10)

    # Standard: 1.5x vol TP, 1.0x vol SL (1.5:1 ratio) — 10m horizon
    tb_vs10m_15_10, v_tb_vs10m_15_10 = _hit_tp_before_sl_volscaled(df, 1.5, 1.0, 10)

    # Aggressive: 2.0x vol TP, 1.0x vol SL (2:1 ratio) — 10m horizon
    tb_vs10m_20_10, v_tb_vs10m_20_10 = _hit_tp_before_sl_volscaled(df, 2.0, 1.0, 10)

    # Standard 30m: 1.5x vol TP, 1.0x vol SL — 30m horizon
    tb_vs30m_15_10, v_tb_vs30m_15_10 = _hit_tp_before_sl_volscaled(df, 1.5, 1.0, 30)

    # Aggressive 30m: 2.0x vol TP, 1.0x vol SL — 30m horizon
    tb_vs30m_20_10, v_tb_vs30m_20_10 = _hit_tp_before_sl_volscaled(df, 2.0, 1.0, 30)

    # Wide 60m: 2.0x vol TP, 1.0x vol SL — 60m horizon
    tb_vs60m_20_10, v_tb_vs60m_20_10 = _hit_tp_before_sl_volscaled(df, 2.0, 1.0, 60)

    targets = {
        # ── Reward/Risk ─────────────────────────────────────────────────
        "bin_rr10m_ge_2": {
            "y": (rr10m >= 2.0).astype(np.int32),
            "valid": valid_rr10m,
        },
        "bin_rr10m_ge_3": {
            "y": (rr10m >= 3.0).astype(np.int32),
            "valid": valid_rr10m,
        },
        "bin_rr30m_ge_2": {
            "y": (rr30m >= 2.0).astype(np.int32),
            "valid": valid_rr30m,
        },

        # ── Vol-scaled triple barrier (adapts to regime) ────────────────
        "vs_tb10m_10_07": {  # 1.0x vol TP / 0.7x vol SL, 10m
            "y": np.nan_to_num(tb_vs10m_10_07, nan=0.0).astype(np.int32),
            "valid": v_tb_vs10m_10_07,
        },
        "vs_tb10m_15_10": {  # 1.5x vol TP / 1.0x vol SL, 10m
            "y": np.nan_to_num(tb_vs10m_15_10, nan=0.0).astype(np.int32),
            "valid": v_tb_vs10m_15_10,
        },
        "vs_tb10m_20_10": {  # 2.0x vol TP / 1.0x vol SL, 10m
            "y": np.nan_to_num(tb_vs10m_20_10, nan=0.0).astype(np.int32),
            "valid": v_tb_vs10m_20_10,
        },
        "vs_tb30m_15_10": {  # 1.5x vol TP / 1.0x vol SL, 30m
            "y": np.nan_to_num(tb_vs30m_15_10, nan=0.0).astype(np.int32),
            "valid": v_tb_vs30m_15_10,
        },
        "vs_tb30m_20_10": {  # 2.0x vol TP / 1.0x vol SL, 30m
            "y": np.nan_to_num(tb_vs30m_20_10, nan=0.0).astype(np.int32),
            "valid": v_tb_vs30m_20_10,
        },
        "vs_tb60m_20_10": {  # 2.0x vol TP / 1.0x vol SL, 60m
            "y": np.nan_to_num(tb_vs60m_20_10, nan=0.0).astype(np.int32),
            "valid": v_tb_vs60m_20_10,
        },

    }

    return targets


# ============================================================================
# Target metadata: (is_multiclass, is_regression, description)
# ============================================================================

TARGET_META: dict[str, tuple[bool, bool, str]] = {
    # Reward/Risk
    "bin_rr10m_ge_2": (False, False, "Reward/Risk 10m >= 2"),
    "bin_rr10m_ge_3": (False, False, "Reward/Risk 10m >= 3"),
    "bin_rr30m_ge_2": (False, False, "Reward/Risk 30m >= 2"),

    # Vol-scaled triple barrier
    "vs_tb10m_10_07": (False, False, "Vol-scaled: 1.0x TP / 0.7x SL en 10m"),
    "vs_tb10m_15_10": (False, False, "Vol-scaled: 1.5x TP / 1.0x SL en 10m"),
    "vs_tb10m_20_10": (False, False, "Vol-scaled: 2.0x TP / 1.0x SL en 10m"),
    "vs_tb30m_15_10": (False, False, "Vol-scaled: 1.5x TP / 1.0x SL en 30m"),
    "vs_tb30m_20_10": (False, False, "Vol-scaled: 2.0x TP / 1.0x SL en 30m"),
    "vs_tb60m_20_10": (False, False, "Vol-scaled: 2.0x TP / 1.0x SL en 60m"),
}
