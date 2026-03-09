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
        "mc_2p0": _multiclass(fr5m, 0.02),              # ±2.0%
        "mc_1p5": _multiclass(fr5m, 0.015),             # ±1.5%

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
}
