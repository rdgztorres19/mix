#!/usr/bin/env node
/**
 * Debug: predict candle-by-candle from training.csv (stock-training).
 *
 * Same logic as debug-predict.js but reads from CSV instead of MySQL.
 * For each 1m candle in window 09:30-11:00, sends all prior candles + metadata
 * to predict.py and displays a table with prob, tradeable, MFR10m, TP/SL result.
 *
 * Usage:
 *   npm run debug-predict-csv -- DTCK 2026-03-10
 *   npm run debug-predict-csv -- DTCK 2026-03-10 09:30 11:00 0.7 4 2
 *
 * Defaults: 09:30-11:00, threshold 0.7, TP 4%, SL 2%, investment $200
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const MARKET_OPEN = '09:30';

// CSV columns from stock-training/src/csv/csv-types.ts
const CSV_COLUMNS = [
  'symbol', 'date', 'candle_time_et', 'candle_idx', 'open', 'high', 'low', 'close', 'volume',
  'atr', 'vwap', 'high_of_day', 'low_of_day', 'change_pct_at_candle', 'ema9', 'ema20',
  'pre_market_high', 'session',
  'shares_outstanding', 'market_cap', 'gap_pct', 'premarket_volume',
  'momentum_acumulado', 'change_1m', 'change_5m', 'change_10m', 'minutes_since_hod',
  'volume_rel', 'dist_vwap_pct', 'atr_rel', 'minute_of_day', 'rsi', 'volatility_15m',
  'mom_5', 'mom_10', 'return_lag_1', 'return_lag_2', 'return_lag_3',
  'dist_hod_pct', 'dist_lod_pct', 'dist_pm_high', 'break_hod', 'break_pm_high',
  'range_expansion', 'float_rotation', 'dollar_volume', 'relative_dollar_volume',
  'volume_spike', 'vwap_cross_up', 'dist_ema9', 'dist_ema20', 'momentum_acceleration',
  'is_open', 'is_midday', 'is_power_hour', 'dist_gap', 'relative_range',
  'future_return_5m', 'target', 'target_break_hod_5m', 'max_future_return_10m',
];

// ─── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter(a => a !== '--');
const ticker = (args[0] || '').toUpperCase();
const dateStr = args[1] || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const fromTime = args[2] || MARKET_OPEN;
const toTime = args[3] || '11:00';
const THRESHOLD = parseFloat(args[4]) || 0.7;
const TP_PCT = parseFloat(args[5]) || 4;
const SL_PCT = parseFloat(args[6]) || 2;
const INVESTMENT = 200;

/**
 * Parse a CSV line (handles quoted fields with commas).
 */
function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) {
      values.push(current.replace(/^"|"$/g, '').trim());
      current = '';
    } else current += c;
  }
  values.push(current.replace(/^"|"$/g, '').trim());
  return values;
}

function toNum(v) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Load CSV, filter by symbol+date, return rows as objects.
 */
function loadAndFilterCsv(csvPath, sym, date) {
  if (!fs.existsSync(csvPath)) {
    return null;
  }
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  if (!lines.length) return [];

  const hasHeader = (() => {
    const first = parseCsvLine(lines[0]);
    return first[0] && String(first[0]).toLowerCase() === 'symbol';
  })();
  const dataStart = hasHeader ? 1 : 0;

  const rows = [];
  for (let i = dataStart; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (vals.length < 26) continue;

    const row = {};
    for (let j = 0; j < CSV_COLUMNS.length; j++) {
      const col = CSV_COLUMNS[j];
      const v = vals[j];
      if (col === 'symbol' || col === 'date' || col === 'candle_time_et' || col === 'session') {
        row[col] = String(v || '');
      } else {
        row[col] = toNum(v);
      }
    }
    if (row.symbol === sym && String(row.date) === String(date)) {
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.candle_idx - b.candle_idx);
  return rows;
}

/**
 * Simulate: did price hit +TP% before -SL% in next 10 candles?
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
  const parts = String(t).split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

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
  if (!ticker) {
    console.error('Usage: npm run debug-predict-csv -- TICKER DATE [fromTime] [toTime] [threshold] [tpPct] [slPct]');
    console.error('  Defaults: 09:30 11:00 0.7 4 2');
    process.exit(1);
  }

  const csvPath = path.join(__dirname, '..', '..', 'stock-training', 'data', 'training.csv');
  const rows = loadAndFilterCsv(csvPath, ticker, dateStr);

  if (!rows || !rows.length) {
    console.error(`No data for ${ticker} on ${dateStr} in ${csvPath}`);
    process.exit(1);
  }

  const fromMin = timeToMin(fromTime);
  const toMin = timeToMin(toTime);

  const targetRows = [];
  for (let i = 0; i < rows.length; i++) {
    const t = String(rows[i].candle_time_et || '');
    const min = timeToMin(t);
    if (min >= fromMin && min <= toMin) {
      targetRows.push({ idx: i, row: rows[i], time: t });
    }
  }

  if (!targetRows.length) {
    console.error(`No candles in ${fromTime}–${toTime} range for ${ticker} ${dateStr}`);
    process.exit(1);
  }

  console.log(`\n🔮 Debug Predict CSV: ${ticker} | ${dateStr} | ${fromTime}–${toTime}`);
  console.log(`   Threshold=${THRESHOLD} | TP=${TP_PCT}% | SL=${SL_PCT}% | Investment=$${INVESTMENT}`);
  console.log('─'.repeat(120));
  console.log(`Found ${rows.length} total candles, iterating ${targetRows.length} in window\n`);

  const tpDec = TP_PCT / 100;
  const slDec = SL_PCT / 100;

  const allCandles = rows.map((r, i) => ({
    t: i,
    o: toNum(r.open),
    h: toNum(r.high),
    l: toNum(r.low),
    c: toNum(r.close),
    v: toNum(r.volume),
  }));
  const allCandleTimesEt = rows.map(r => String(r.candle_time_et || '09:30'));
  const allCandleIdxArr = rows.map(r => toNum(r.candle_idx));

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
    'TP/SL'.padStart(8),
    'Match'.padStart(6),
    `P/L $${INVESTMENT}`.padStart(10),
    'Cumul'.padStart(10),
  ].join(' | ');
  console.log(hdr);
  console.log('─'.repeat(hdr.length));

  const payloads = targetRows.map(({ idx, row }) => {
    const candlesSlice = allCandles.slice(0, idx + 1);
    return {
      candles: candlesSlice,
      target_idx: candlesSlice.length - 1,
      candle_times_et: allCandleTimesEt.slice(0, idx + 1),
      candle_idx_arr: allCandleIdxArr.slice(0, idx + 1),
      atr: toNum(row.atr),
      high_of_day: toNum(row.high_of_day),
      low_of_day: toNum(row.low_of_day),
      pre_market_high: toNum(row.pre_market_high),
      change_pct_at_candle: toNum(row.change_pct_at_candle),
      shares_outstanding: toNum(row.shares_outstanding),
      market_cap: toNum(row.market_cap),
      gap_pct: toNum(row.gap_pct),
      premarket_volume: toNum(row.premarket_volume),
    };
  });

  let results = [];
  try {
    results = await callPredictBatch(payloads, THRESHOLD);
  } catch (e) {
    console.error('Batch predict failed:', e.message);
    process.exit(1);
  }

  let tp = 0, fp = 0, tn = 0, fn = 0;
  let cumPnL = 0;

  for (let i = 0; i < targetRows.length; i++) {
    const { idx, row, time } = targetRows[i];
    const targetRow = row;
    const r = results[i] || {};
    const prob = r.prob || 0;
    const tradeable = r.tradeable || false;

    const mfr = toNum(targetRow.max_future_return_10m);
    const realGood = mfr >= tpDec;
    const futureCandles = rows.slice(idx + 1, idx + 11).map(r => ({
      o: toNum(r.open),
      h: toNum(r.high),
      l: toNum(r.low),
      c: toNum(r.close),
    }));
    const tpSlResult = hitTpBeforeSl(futureCandles, toNum(targetRow.close), tpDec, slDec);
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
      toNum(targetRow.open).toFixed(3).padStart(8),
      toNum(targetRow.high).toFixed(3).padStart(8),
      toNum(targetRow.low).toFixed(3).padStart(8),
      toNum(targetRow.close).toFixed(3).padStart(8),
      String(toNum(targetRow.volume)).padStart(10),
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

  console.log('\n' + '═'.repeat(60));
  const total = tp + fp + tn + fn;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const accuracy = total > 0 ? (tp + tn) / total : 0;
  console.log(`Confusion: TP=${tp}  FP=${fp}  TN=${tn}  FN=${fn}`);
  console.log(`Precision: ${(precision * 100).toFixed(1)}%  Recall: ${(recall * 100).toFixed(1)}%  Accuracy: ${(accuracy * 100).toFixed(1)}%`);
  console.log(`Signals (tradeable=true): ${tp + fp} / ${total}`);
  console.log(`\n💰 Inversión $${INVESTMENT}/trade → P/L total: ${cumPnL >= 0 ? '+' : ''}$${cumPnL.toFixed(2)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
