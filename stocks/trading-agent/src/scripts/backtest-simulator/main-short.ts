/**
 * main-short.ts — Backtest simulator for SHORT positions using bearish models.
 *
 * Uses bearish prediction models (bin_drop_4p0_30m, bin_sl_before_tp_10m, etc.)
 * to predict when stocks will DROP, then enters short positions.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest-simulator/main-short.ts <date> <startTime> <endTime> <threshold> <targetPct> <stopLossPct>
 *
 * Example:
 *   npx ts-node src/scripts/backtest-simulator/main-short.ts 2026-03-25 09:30 11:00 0.70 4 2
 *
 * Env vars:
 *   PREDICT_MODEL — model dir (default: XGBoost_D_clean_bin_drop_4p0_30m)
 */

// Route to short prediction script
process.env.PREDICT_BATCH_SCRIPT = 'predict_batch_short.py';

// Default model
if (!process.env.PREDICT_MODEL) {
  process.env.PREDICT_MODEL = 'XGBoost_D_clean_bin_drop_4p0_30m';
}

// Force short direction
const args = process.argv.slice(2);
if (!args.includes('--short')) {
  process.argv.push('--short');
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./main');
