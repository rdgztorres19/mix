/**
 * main-lstm.ts — Backtest simulator using the LSTM sequence model.
 *
 * Identical to main.ts but routes predictions through predict_batch_sequence.py.
 * Same args and flags as main.ts:
 *   npx ts-node src/scripts/backtest-simulator/main-lstm.ts --date 2025-12-15
 *   npx ts-node src/scripts/backtest-simulator/main-lstm.ts --date 2025-12-15 --threshold 0.75
 *
 * Env vars (optional):
 *   LSTM_TARGET       — model target (default: bin_rr10m_ge_2)
 *   SEQ_LEN           — sequence window length (default: 30)
 *   PREDICT_THRESHOLD — default probability threshold (default: 0.70)
 */

// Set predict script before main.ts imports PredictorClient — the constructor
// reads this env var at instantiation time (inside async main()), so it picks
// up the value set here even though the module is require()'d below.
process.env.PREDICT_BATCH_SCRIPT = 'predict_batch_sequence.py';

// Optional: LSTM_MODEL_TYPE can be passed as 8th positional arg (lstm|gru|transformer)
// e.g. npx ts-node main-lstm.ts 2026-03-25 09:30 11:00 0.70 4 2 gru
const modelTypeArg = process.argv[8];
if (modelTypeArg && ['lstm', 'gru', 'transformer'].includes(modelTypeArg)) {
  process.env.LSTM_MODEL_TYPE = modelTypeArg;
  process.argv.splice(8, 1); // remove it so main.ts doesn't see it
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./main');
