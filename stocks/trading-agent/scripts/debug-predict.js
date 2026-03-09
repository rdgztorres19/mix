#!/usr/bin/env node
/**
 * Debug: predict candle-by-candle from MySQL historical data.
 *
 * For each 1m candle (market open onward), sends all prior candles + metadata
 * to predict.py and displays a table showing:
 *   - Time ET, OHLCV
 *   - Model probability & tradeable flag
 *   - Actual max_future_return_10m (did it really move ≥1.5%?)
 *
 * Usage:
 *   npm run debug-predict -- TPET 2026-03-06
 *   npm run debug-predict -- TPET 2026-03-06 09:30 10:00
 *   npm run debug-predict -- TPET 2026-03-06 09:30 10:00 0.4   ← threshold custom
 */

const { spawn } = require('child_process');
const path = require('path');
const mysql = require('mysql2/promise');

const MARKET_OPEN = '09:30';

// ─── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter(a => a !== '--');
const ticker = (args[0] || 'TPET').toUpperCase(); // default to TPET for testing
const dateStr = args[1] || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); //Example: "2026-03-06"
const fromTime = args[2] || MARKET_OPEN; //example: "09:30"
const toTime = args[3] || '16:00'; //example: "10:00"
const THRESHOLD = parseFloat(args[4]) || 0.6; // 5th arg: threshold (default 0.6)

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
const fromMin = timeToMin(fromTime);
const toMin = timeToMin(toTime);

// ─── Python predict ──────────────────────────────────────────────────────────
const stockTraining = path.resolve(__dirname, '..', '..', 'stock-training');
const predictScript = path.join(stockTraining, 'ml', 'experiments', 'predict.py');

function callPredict(payload) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [predictScript], {
      cwd: path.dirname(predictScript),
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
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new Error(`Bad JSON: ${stdout}`)); }
    });
    proc.stdin.write(JSON.stringify(payload), () => proc.stdin.end());
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔮 Debug Predict: ${ticker} | ${dateStr} | ${fromTime}–${toTime} | threshold=${THRESHOLD}`);
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

  // Table header
  const INVESTMENT = 200; // dollars per trade
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
    'Real≥1.5%'.padStart(10),
    'Match'.padStart(6),
    'P/L $200'.padStart(10),
    'Cumul'.padStart(10),
  ].join(' | ');
  console.log(hdr);
  console.log('─'.repeat(hdr.length));

  let tp = 0, fp = 0, tn = 0, fn = 0;
  let cumPnL = 0;

  for (const { idx, row, time } of targetRows) {
    // Send all candles up to and including this one
    const candlesSlice = allCandles.slice(0, idx + 1);
    const targetRow = row;

    const payload = {
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
      _threshold: THRESHOLD,
    };

    let prob = 0, tradeable = false;
    try {
      const result = await callPredict(payload);
      prob = result.prob;
      tradeable = result.tradeable;
    } catch (e) {
      process.stderr.write(`  ⚠ ${time}: ${e.message}\n`);
    }

    // Actual: max_future_return_10m
    const mfr = Number(targetRow.max_future_return_10m || 0);
    const realGood = mfr >= 0.015; // ≥1.5%

    // Confusion matrix
    if (tradeable && realGood) tp++;
    else if (tradeable && !realGood) fp++;
    else if (!tradeable && realGood) fn++;
    else tn++;

    const match = tradeable === realGood;

    // P/L: if we traded, gain/loss = $INVESTMENT * actual return
    const pnl = tradeable ? INVESTMENT * mfr : 0;
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
