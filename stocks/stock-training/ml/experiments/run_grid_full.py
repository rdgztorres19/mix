#!/usr/bin/env python3
"""
run_grid_full.py — Grid search for best bullish AND bearish targets.
Runs top targets with best feature sets and models.

Usage:
  cd stock-training/ml
  python -m experiments.run_grid_full
"""

from experiments.run_grid import run_grid

# Best bullish targets
BULLISH_TARGETS = [
    "bin_rr10m_ge_2",
    "bin_rr10m_ge_3",
    "bin_rr30m_ge_2",
    "bin_tb30m_tp4p0_sl2p0",
    "bin_tb60m_tp4p0_sl2p0",
    "bin_tb10m_tp4p0_sl2p0",
    "bin_clean_entry_10m",
    "bin_clean_entry_30m",
    "bin_sustained_momentum_10m",
    "bin_follow_through_hod_10m_1p0",
]

# Best bearish targets
BEARISH_TARGETS = [
    "bin_drop_2p0_10m",
    "bin_drop_4p0_10m",
    "bin_drop_2p0_30m",
    "bin_drop_4p0_30m",
    "bin_rr10m_bearish_ge_2",
    "bin_breakdown_lod_10m",
    "bin_fr10m_neg_1p0",
    "bin_clean_short_10m",
]

ALL_TARGETS = BULLISH_TARGETS + BEARISH_TARGETS

FEATURE_SETS = [
    "V3",           # V2_full + Tier 1 indicators (89 features)
    "V3_bear",      # V3 + bearish features (102 features)
    "V3_tier1",     # V2_core + Tier 1 only (55 features)
    "V2_full",      # baseline without Tier 1
    "D_clean_ext",  # baseline
]

MODELS = [
    "LightGBM",
    "XGBoost",
]

if __name__ == "__main__":
    # 2 models x 5 fsets x 18 targets = 180 combos
    run_grid(
        models_filter=MODELS,
        fsets_filter=FEATURE_SETS,
        targets_filter=ALL_TARGETS,
    )
