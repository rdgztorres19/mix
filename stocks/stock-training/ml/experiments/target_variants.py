"""
Target variants — compute different label definitions from the base CSV columns.
All computed in-memory, never modifies the original CSV.

Base columns available:
  - future_return_5m    (close[t+5] - close[t]) / close[t]
  - target              original multiclass: +1 if fr5m > 2.5%, -1 if < -2.5%, else 0
  - target_break_hod_5m 1 if max(high[t+1..t+5]) > HOD
  - max_future_return_10m (max(high[t+1..t+10]) - close[t]) / close[t]
"""

import numpy as np
import pandas as pd


def _multiclass(arr: np.ndarray, threshold: float) -> np.ndarray:
    """Convert continuous return → -1/0/1 multiclass."""
    out = np.zeros(len(arr), dtype=np.int32)
    out[arr > threshold] = 1
    out[arr < -threshold] = -1
    return out


def _binary(arr: np.ndarray, threshold: float) -> np.ndarray:
    """Convert continuous return → 0/1 binary."""
    return (arr > threshold).astype(np.int32)


def _simulate_first_touch(
    o: np.ndarray, h: np.ndarray, lo: np.ndarray, c: np.ndarray,
    prev_close: float, level_up: float, level_down: float,
) -> int:
    """
    Simulate price trajectory over 10 candles; return 1 if +x% hit before -x%, else 0.
    prev_close = close of reference bar. o,h,lo,c = arrays of length 10 for future candles.
    """
    for j in range(10):
        open_j, high_j, low_j, close_j = o[j], h[j], lo[j], c[j]

        # Gap prev_close -> open_j: only one threshold can be crossed (linear path)
        if prev_close < open_j:  # gap up
            if prev_close < level_up < open_j:
                return 1
        elif prev_close > open_j:  # gap down
            if open_j < level_down < prev_close:
                return 0

        # Intra-candle: alcista (C>O) → open→low→high→close; bajista → open→high→low→close
        touch_up = high_j >= level_up
        touch_down = low_j <= level_down
        if touch_up and touch_down:
            # Both in same candle — order depends on candle type
            if close_j >= open_j:  # alcista: low before high
                return 0  # stop first
            return 1  # target first
        if touch_up:
            return 1
        if touch_down:
            return 0

        prev_close = close_j
    return 0


def _hit_up_before_down(df: pd.DataFrame, threshold: float) -> np.ndarray:
    """
    Binary target: 1 if price touched +x% before -x% in next 10 candles, else 0.
    Requires OHLC columns and grouping by (symbol, date).
    """
    required = ["open", "high", "low", "close", "symbol", "date"]
    if not all(col in df.columns for col in required):
        return np.zeros(len(df), dtype=np.int32)

    out = np.zeros(len(df), dtype=np.int32)
    for (_sym, _date), grp in df.groupby(["symbol", "date"], sort=False):
        idx = grp.index.values
        n = len(grp)
        o = grp["open"].values.astype(np.float64)
        h = grp["high"].values.astype(np.float64)
        lo = grp["low"].values.astype(np.float64)
        c = grp["close"].values.astype(np.float64)

        for i in range(n):
            if i + 10 >= n:
                continue
            close_t = c[i]
            if close_t <= 0:
                continue
            level_up = close_t * (1.0 + threshold)
            level_down = close_t * (1.0 - threshold)
            result = _simulate_first_touch(
                o[i + 1 : i + 11],
                h[i + 1 : i + 11],
                lo[i + 1 : i + 11],
                c[i + 1 : i + 11],
                close_t,
                level_up,
                level_down,
            )
            out[idx[i]] = result
    return out


def _hit_tp_before_sl(df: pd.DataFrame, take_profit: float, stop_loss: float) -> np.ndarray:
    """
    Binary target: 1 if price touched +take_profit before -stop_loss in next 10 candles, else 0.
    Requires OHLC columns and grouping by (symbol, date).
    """
    required = ["open", "high", "low", "close", "symbol", "date"]
    if not all(col in df.columns for col in required):
        return np.zeros(len(df), dtype=np.int32)

    out = np.zeros(len(df), dtype=np.int32)
    for (_sym, _date), grp in df.groupby(["symbol", "date"], sort=False):
        idx = grp.index.values
        n = len(grp)
        o = grp["open"].values.astype(np.float64)
        h = grp["high"].values.astype(np.float64)
        lo = grp["low"].values.astype(np.float64)
        c = grp["close"].values.astype(np.float64)

        for i in range(n):
            if i + 10 >= n:
                continue
            close_t = c[i]
            if close_t <= 0:
                continue

            level_up = close_t * (1.0 + take_profit)
            level_down = close_t * (1.0 - stop_loss)

            result = _simulate_first_touch(
                o[i + 1 : i + 11],
                h[i + 1 : i + 11],
                lo[i + 1 : i + 11],
                c[i + 1 : i + 11],
                close_t,
                level_up,
                level_down,
            )
            out[idx[i]] = result

    return out


def compute_target_variants(df: pd.DataFrame) -> dict[str, np.ndarray]:
    """
    Return a dict of {target_name: array} for all target variants.
    Each array has the same length as df (NaN rows → 0 label).
    """
    fr5m = df["future_return_5m"].values.astype(np.float64) if "future_return_5m" in df.columns else np.zeros(len(df))
    fr5m = np.nan_to_num(fr5m, nan=0.0)

    mfr10m = df["max_future_return_10m"].values.astype(np.float64) if "max_future_return_10m" in df.columns else np.zeros(len(df))
    mfr10m = np.nan_to_num(mfr10m, nan=0.0)

    brk_hod = df["target_break_hod_5m"].values.astype(np.float64) if "target_break_hod_5m" in df.columns else np.zeros(len(df))
    brk_hod = np.nan_to_num(brk_hod, nan=0.0).astype(np.int32)

    original = df["target"].values.astype(np.float64) if "target" in df.columns else np.zeros(len(df))
    original = np.nan_to_num(original, nan=0.0).astype(np.int32)

    targets = {
        # --- Multiclass targets (-1/0/1) ---
        "mc_2p5": original,                             # original: ±2.5%
        "mc_2p0": _multiclass(fr5m, 0.02),             # ±2.0%
        "mc_1p5": _multiclass(fr5m, 0.015),            # ±1.5%

        # --- Binary targets (0/1) — future return 5m ---
        "bin_fr5m_2p5": _binary(fr5m, 0.025),
        "bin_fr5m_2p0": _binary(fr5m, 0.02),
        "bin_fr5m_1p5": _binary(fr5m, 0.015),
        "bin_fr5m_1p0": _binary(fr5m, 0.01),

        # --- Binary targets (0/1) — max future return 10m ---
        "bin_mfr10m_2p5": _binary(mfr10m, 0.025),
        "bin_mfr10m_2p0": _binary(mfr10m, 0.02),
        "bin_mfr10m_1p5": _binary(mfr10m, 0.015),
        "bin_mfr10m_1p0": _binary(mfr10m, 0.01),

        # --- Break HOD ---
        "bin_break_hod": brk_hod,

        # --- First touch 10m: alcanzó +x% antes de -x% en 10 velas ---
        "bin_first_touch_10m_2p5": _hit_up_before_down(df, 0.025),
        "bin_first_touch_10m_2p0": _hit_up_before_down(df, 0.02),
        "bin_first_touch_10m_1p5": _hit_up_before_down(df, 0.015),
        "bin_first_touch_10m_1p0": _hit_up_before_down(df, 0.01),

        # --- Triple-barrier style / TP before SL in 10 candles ---
        "bin_tb10m_tp1p5_sl0p5": _hit_tp_before_sl(df, 0.015, 0.005),
        "bin_tb10m_tp2p0_sl0p7": _hit_tp_before_sl(df, 0.020, 0.007),
        "bin_tb10m_tp2p5_sl1p0": _hit_tp_before_sl(df, 0.025, 0.010),

        "bin_tb10m_tp4p0_sl2p0": _hit_tp_before_sl(df, 0.04, 0.02),
        "bin_tb10m_tp5p0_sl2p5": _hit_tp_before_sl(df, 0.05, 0.025),
        "bin_tb10m_tp6p0_sl3p0": _hit_tp_before_sl(df, 0.06, 0.03),
    }

    return targets


# Target metadata: name → (is_multiclass, description)
TARGET_META = {
    "mc_2p5":           (True,  "Multiclass ±2.5% (original)"),
    "mc_2p0":           (True,  "Multiclass ±2.0%"),
    "mc_1p5":           (True,  "Multiclass ±1.5%"),

    "bin_fr5m_2p5":     (False, "Binary: future_return_5m > 2.5%"),
    "bin_fr5m_2p0":     (False, "Binary: future_return_5m > 2.0%"),
    "bin_fr5m_1p5":     (False, "Binary: future_return_5m > 1.5%"),
    "bin_fr5m_1p0":     (False, "Binary: future_return_5m > 1.0%"),

    "bin_mfr10m_2p5":   (False, "Binary: max_future_return_10m > 2.5%"),
    "bin_mfr10m_2p0":   (False, "Binary: max_future_return_10m > 2.0%"),
    "bin_mfr10m_1p5":   (False, "Binary: max_future_return_10m > 1.5%"),
    "bin_mfr10m_1p0":   (False, "Binary: max_future_return_10m > 1.0%"),

    "bin_break_hod":    (False, "Binary: breaks HOD within 5 candles"),

    "bin_first_touch_10m_2p5": (False, "Alcanzó +2.5% antes de -2.5% en 10 velas"),
    "bin_first_touch_10m_2p0": (False, "Alcanzó +2.0% antes de -2.0% en 10 velas"),
    "bin_first_touch_10m_1p5": (False, "Alcanzó +1.5% antes de -1.5% en 10 velas"),
    "bin_first_touch_10m_1p0": (False, "Alcanzó +1.0% antes de -1.0% en 10 velas"),

    "bin_tb10m_tp1p5_sl0p5":   (False, "Alcanzó +1.5% antes de -0.5% en 10 velas"),
    "bin_tb10m_tp2p0_sl0p7":   (False, "Alcanzó +2.0% antes de -0.7% en 10 velas"),
    "bin_tb10m_tp2p5_sl1p0":   (False, "Alcanzó +2.5% antes de -1.0% en 10 velas"),

    "bin_tb10m_tp4p0_sl2p0":   (False, "Alcanzó +4.0% antes de -2.0% en 10 velas"),
    "bin_tb10m_tp5p0_sl2p5":   (False, "Alcanzó +5.0% antes de -2.5% en 10 velas"),
    "bin_tb10m_tp6p0_sl3p0":   (False, "Alcanzó +6.0% antes de -3.0% en 10 velas"),
}