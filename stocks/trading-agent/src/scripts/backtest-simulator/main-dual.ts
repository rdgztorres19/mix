/**
 * main-dual.ts — Backtest simulator using dual-model strategy.
 *
 * Model 1 (vol_exp): "Is a big move coming?" → prob >= 0.80
 * Model 2 (rr10m_ge_2): "Is direction favorable?" → prob >= 0.60
 * TP/SL: dynamic, ATR-based (2×ATR TP, 1×ATR SL)
 *
 * Only trades when BOTH models agree.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest-simulator/main-dual.ts <date> <startTime> <endTime>
 *
 * Example:
 *   npx ts-node src/scripts/backtest-simulator/main-dual.ts 2026-03-25 09:30 11:00
 *
 * Env vars (optional):
 *   DUAL_VOL_MODEL       — vol model dir (default: XGBoost_V2_full_bin_vol_exp_10m_2atr)
 *   DUAL_RR_MODEL        — rr model dir (default: XGBoost_V2_full_bin_rr10m_ge_2)
 *   DUAL_VOL_THRESHOLD   — vol threshold (default: 0.80)
 *   DUAL_RR_THRESHOLD    — rr threshold (default: 0.60)
 */

// Route to dual prediction script
process.env.PREDICT_BATCH_SCRIPT = 'predict_batch_dual.py';

// Default thresholds for dual model (the Python script reads these)
if (!process.env.DUAL_VOL_THRESHOLD) process.env.DUAL_VOL_THRESHOLD = '0.80';
if (!process.env.DUAL_RR_THRESHOLD) process.env.DUAL_RR_THRESHOLD = '0.60';

// Override CLI args: date, startTime, endTime are positional (args 2,3,4)
// For dual model, TP/SL come from the model (dynamic ATR-based),
// but we still need fallback values for TradeSimulator constructor.
// Use generous defaults that will be overridden per-trade by dynamic values.
const args = process.argv.slice(2);
if (args.length >= 3 && args.length < 6) {
  // User only passed: date startTime endTime
  // Add default threshold=0.60 targetPct=10 stopLossPct=5 (generous fallbacks)
  process.argv.push('0.60');  // threshold (rr_threshold controls actual filtering)
  process.argv.push('10');    // fallback TP% (overridden by dynamic ATR TP)
  process.argv.push('5');     // fallback SL% (overridden by dynamic ATR SL)
}

// News filters (disabled by default, enable with DUAL_REQUIRE_CATALYST=true)
import { FILTERS } from './trade-filters';
if (process.env.DUAL_REQUIRE_CATALYST === 'true') {
  FILTERS.requireCatalyst.enabled = true;
}
if (process.env.DUAL_NO_DILUTION === 'true') {
  FILTERS.noDilution.enabled = true;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./main');
