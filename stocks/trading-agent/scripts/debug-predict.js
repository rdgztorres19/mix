#!/usr/bin/env node
/**
 * Debug: predict candle-by-candle from MySQL historical data.
 *
 * For each 1m candle (market open onward), sends all prior candles + metadata
 * to predict.py and displays a table showing:
 *   - Time ET, OHLCV
 *   - Model probability & tradeable flag
 *   - Actual max_future_return_10m
 *   - TP/SL result: did price hit +TP% before -SL%? (win/loss/neutral)
 *
 * Usage:
 *   npm run debug-predict -- TPET 2026-03-06
 *   npm run debug-predict -- TPET 2026-03-06 09:30 10:00
 *   npm run debug-predict -- TPET 2026-03-06 09:30 10:00 0.6      ← threshold
 *   npm run debug-predict -- TPET 2026-03-06 09:30 10:00 0.6 1.5 0.5  ← threshold, TP%, SL%
 */

const { spawn } = require('child_process');
const path = require('path');
const mysql = require('mysql2/promise');

const MARKET_OPEN = '09:30';

// ─── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter(a => a !== '--');
const ticker = (args[0] || 'TPET').toUpperCase();
const dateStr = args[1] || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const fromTime = args[2] || MARKET_OPEN;
const toTime = args[3] || '16:00';
const THRESHOLD = parseFloat(args[4]) || 0.6;
const TP_PCT = parseFloat(args[5]) || 1.5;   // take profit % (default 1.5)
const SL_PCT = parseFloat(args[6]) || 1.5;   // stop loss % (default 1.5)

/**
 * Simulate: did price hit +TP% before -SL% in next 10 candles?
 * @param {Array<{o,h,l,c}>} futureCandles - next 10 candles OHLC
 * @param {number} refClose - close of reference bar
 * @param {number} tpPct - take profit as decimal (e.g. 0.015)
 * @param {number} slPct - stop loss as decimal (e.g. 0.015)
 * @returns {'win'|'loss'|'neutral'}
 */
function hitTpBeforeSl(futureCandles, refClose, tpPct, slPct) {
  if (!futureCandles.length || refClose <= 0) return 'neutral';
  const levelUp = refClose * (1 + tpPct);
  const levelDown = refClose * (1 - slPct);
  let prevClose = refClose;
  for (let j = 0; j < Math.min(10, futureCandles.length); j++) {
    const { o: openJ, h: highJ, l: lowJ, c: closeJ } = futureCandles[j];
    if (prevClose < openJ) {
      if (prevClose < levelUp && levelUp < openJ) return 'win';
    } else if (prevClose > openJ) {
      if (openJ < levelDown && levelDown < prevClose) return 'loss';
    }
    const touchUp = highJ >= levelUp;
    const touchDown = lowJ <= levelDown;
    if (touchUp && touchDown) {
      if (closeJ >= openJ) return 'loss';
      return 'win';
    }
    if (touchUp) return 'win';
    if (touchDown) return 'loss';
    prevClose = closeJ;
  }
  return 'neutral';
}

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
const fromMin = timeToMin(fromTime);
const toMin = timeToMin(toTime);

// ─── Python predict (batch mode for speed) ────────────────────────────────────
const stockTraining = path.resolve(__dirname, '..', '..', 'stock-training');
const predictBatchScript = path.join(stockTraining, 'ml', 'experiments', 'predict_batch.py');

function callPredictBatch(batch, threshold) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [predictBatchScript], {
      cwd: path.dirname(predictBatchScript),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', c => { stdout += c; });
    proc.stderr.on('data', c => { stderr += c; });
    proc.on('close', code => {
      if (code !== 0 || !stdout.trim()) {
        reject(new Error(stderr || `exit ${code}, stdout="${stdout}"`));
        return;
      }
      try {
        const out = JSON.parse(stdout);
        if (out.error) reject(new Error(out.error));
        else resolve(out.results || []);
      } catch { reject(new Error(`Bad JSON: ${stdout}`)); }
    });
    proc.stdin.write(JSON.stringify({ batch, _threshold: threshold }), () => proc.stdin.end());
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔮 Debug Predict: ${ticker} | ${dateStr} | ${fromTime}–${toTime}`);
  console.log(`   Threshold=${THRESHOLD} | TP=${TP_PCT}% | SL=${SL_PCT}%`);
  console.log('─'.repeat(120));

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'sbrQp10',
    database: process.env.MYSQL_DATABASE_TRAINING || 'stock_training',
  });

  const [rows] = await conn.query(
    'SELECT * FROM training_1m WHERE symbol = ? AND date = ? ORDER BY candle_idx ASC',
    [ticker, dateStr],
  );

  if (!rows.length) {
    console.error(`No data for ${ticker} on ${dateStr}`);
    await conn.end();
    process.exit(1);
  }

  // Build candle array (all rows, for feeding history to predict)
  const allCandles = rows.map((r, i) => ({
    t: i,
    o: Number(r.open || 0),
    h: Number(r.high || 0),
    l: Number(r.low || 0),
    c: Number(r.close || 0),
    v: Number(r.volume || 0),
  }));

  // Pass original candle_time_et and candle_idx from MySQL for feature accuracy
  const allCandleTimesEt = rows.map(r => String(r.candle_time_et || '09:30'));
  const allCandleIdxArr = rows.map(r => Number(r.candle_idx || 0));

  // Filter rows in the time window for iteration
  const targetRows = [];
  for (let i = 0; i < rows.length; i++) {
    const t = String(rows[i].candle_time_et || '');
    const min = timeToMin(t);
    if (min >= fromMin && min <= toMin) {
      targetRows.push({ idx: i, row: rows[i], time: t });
    }
  }

  if (!targetRows.length) {
    console.error(`No candles in ${fromTime}–${toTime} range`);
    await conn.end();
    process.exit(1);
  }

  console.log(`Found ${rows.length} total candles, iterating ${targetRows.length} in window\n`);

  // Build all payloads for batch predict (one Python process, one model load)
  const payloads = targetRows.map(({ idx, row }) => {
    const candlesSlice = allCandles.slice(0, idx + 1);
    const targetRow = row;
    return {
      candles: candlesSlice,
      target_idx: candlesSlice.length - 1,
      candle_times_et: allCandleTimesEt.slice(0, idx + 1),
      candle_idx_arr: allCandleIdxArr.slice(0, idx + 1),
      atr: Number(targetRow.atr || 0),
      high_of_day: Number(targetRow.high_of_day || 0),
      low_of_day: Number(targetRow.low_of_day || 0),
      pre_market_high: Number(targetRow.pre_market_high || 0),
      change_pct_at_candle: Number(targetRow.change_pct_at_candle || 0),
      shares_outstanding: Number(targetRow.shares_outstanding || 0),
      market_cap: Number(targetRow.market_cap || 0),
      gap_pct: Number(targetRow.gap_pct || 0),
      premarket_volume: Number(targetRow.premarket_volume || 0),
    };
  });

  let results = [];
  try {
    results = await callPredictBatch(payloads, THRESHOLD);
  } catch (e) {
    console.error('Batch predict failed:', e.message);
    await conn.end();
    process.exit(1);
  }

  // Table header
  const INVESTMENT = 200; // dollars per trade
  const tpDec = TP_PCT / 100;
  const slDec = SL_PCT / 100;
  const hdr = [
    'Time'.padEnd(6),
    'Open'.padStart(8),
    'High'.padStart(8),
    'Low'.padStart(8),
    'Close'.padStart(8),
    'Vol'.padStart(10),
    'Prob'.padStart(7),
    'Trade'.padStart(6),
    'MFR10m'.padStart(8),
    `Real≥${TP_PCT}%`.padStart(10),
    `TP/SL`.padStart(8),
    'Match'.padStart(6),
    'P/L $200'.padStart(10),
    'Cumul'.padStart(10),
  ].join(' | ');
  console.log(hdr);
  console.log('─'.repeat(hdr.length));

  let tp = 0, fp = 0, tn = 0, fn = 0;
  let cumPnL = 0;

  for (let i = 0; i < targetRows.length; i++) {
    const { idx, row, time } = targetRows[i];
    const targetRow = row;
    const r = results[i] || {};
    const prob = r.prob ?? 0;
    const tradeable = r.tradeable ?? false;

    // Actual: max_future_return_10m & TP/SL simulation
    const mfr = Number(targetRow.max_future_return_10m || 0);
    const realGood = mfr >= tpDec;
    const futureCandles = rows.slice(idx + 1, idx + 11).map((row) => ({
      o: Number(row.open || 0),
      h: Number(row.high || 0),
      l: Number(row.low || 0),
      c: Number(row.close || 0),
    }));
    const tpSlResult = hitTpBeforeSl(futureCandles, Number(targetRow.close || 0), tpDec, slDec);
    const tpSlStr = tradeable
      ? (tpSlResult === 'win' ? '  win' : tpSlResult === 'loss' ? ' loss' : '  —')
      : '    ';

    if (tradeable && realGood) tp++;
    else if (tradeable && !realGood) fp++;
    else if (!tradeable && realGood) fn++;
    else tn++;

    const match = tradeable === realGood;

    let pnl = 0;
    if (tradeable) {
      if (tpSlResult === 'win') pnl = INVESTMENT * tpDec;
      else if (tpSlResult === 'loss') pnl = -INVESTMENT * slDec;
      else pnl = INVESTMENT * mfr;
    }
    cumPnL += pnl;

    const line = [
      time.padEnd(6),
      Number(targetRow.open || 0).toFixed(3).padStart(8),
      Number(targetRow.high || 0).toFixed(3).padStart(8),
      Number(targetRow.low || 0).toFixed(3).padStart(8),
      Number(targetRow.close || 0).toFixed(3).padStart(8),
      String(Number(targetRow.volume || 0)).padStart(10),
      prob.toFixed(4).padStart(7),
      (tradeable ? '  ✅' : '  ❌').padStart(6),
      (mfr * 100).toFixed(2).padStart(7) + '%',
      (realGood ? '  ✅' : '  ❌').padStart(10),
      tpSlStr.padStart(8),
      match ? '  ✅' : '  ❌',
      (pnl >= 0 ? '+' : '') + pnl.toFixed(2).padStart(9),
      (cumPnL >= 0 ? '+' : '') + cumPnL.toFixed(2).padStart(9),
    ].join(' | ');
    console.log(line);
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  const total = tp + fp + tn + fn;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const accuracy = total > 0 ? (tp + tn) / total : 0;
  console.log(`Confusion: TP=${tp}  FP=${fp}  TN=${tn}  FN=${fn}`);
  console.log(`Precision: ${(precision * 100).toFixed(1)}%  Recall: ${(recall * 100).toFixed(1)}%  Accuracy: ${(accuracy * 100).toFixed(1)}%`);
  console.log(`Signals (tradeable=true): ${tp + fp} / ${total}`);
  console.log(`\n💰 Inversión $${INVESTMENT}/trade → P/L total: ${cumPnL >= 0 ? '+' : ''}$${cumPnL.toFixed(2)}`);

  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
