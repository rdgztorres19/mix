#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const MARKET_OPEN = '09:30';
const INVESTMENT = 200;

//npm run debug-predict-csv-day-summary 2026-03-25 09:30 11:30 0.65 4 2

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

const args = process.argv.slice(2).filter(a => a !== '--');
const dateStr = args[0] || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const fromTime = args[1] || MARKET_OPEN;
const toTime = args[2] || '11:00';
const THRESHOLD = parseFloat(args[3]) || 0.7;
const TP_PCT = parseFloat(args[4]) || 4;
const SL_PCT = parseFloat(args[5]) || 2;

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === ',' || c === '\t') && !inQuotes) {
      values.push(current.replace(/^"|"$/g, '').trim());
      current = '';
    } else {
      current += c;
    }
  }

  values.push(current.replace(/^"|"$/g, '').trim());
  return values;
}

function toNum(v) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function timeToMin(t) {
  const parts = String(t || '').trim().split(':');
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
}

function normalizeDateStr(s) {
  const v = String(s || '').trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const mm = m[1].padStart(2, '0');
    const dd = m[2].padStart(2, '0');
    const yyyy = `20${m[3]}`;
    return `${yyyy}-${mm}-${dd}`;
  }

  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, '0');
    const dd = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }

  m = v.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (m) {
    const mm = m[1].padStart(2, '0');
    const dd = m[2].padStart(2, '0');
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }

  return v;
}

function safeDiv(a, b) {
  return b > 0 ? a / b : 0;
}

function fmtPct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtMoney(x) {
  return `${x >= 0 ? '+' : '-'}$${Math.abs(x).toFixed(2)}`;
}

function padRight(str, len) {
  return String(str).padEnd(len);
}

function padLeft(str, len) {
  return String(str).padStart(len);
}

function sortRows(rows) {
  rows.sort((a, b) => {
    const ta = timeToMin(a.candle_time_et);
    const tb = timeToMin(b.candle_time_et);
    if (ta !== tb) return ta - tb;
    return toNum(a.candle_idx) - toNum(b.candle_idx);
  });
}

async function loadCsvByDate(csvPath, date) {
  if (!fs.existsSync(csvPath)) return null;

  const readline = require('readline');
  const lines = [];

  // Stream line by line — handles files >1GB without memory issues
  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  let hasHeader = false;

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    if (lineNum === 0) {
      const first = parseCsvLine(line);
      hasHeader = first[0] && String(first[0]).toLowerCase() === 'symbol';
      lineNum++;
      if (hasHeader) continue;
    }
    lineNum++;

    // Quick filter: only parse lines containing the target date
    if (!line.includes(date)) continue;

    lines.push(line);
  }

  if (!lines.length) return [];

  const dataStart = hasHeader ? 1 : 0;
  const normalizedTargetDate = normalizeDateStr(date);
  const rows = [];

  for (let i = dataStart; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (vals.length < 20) continue;

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

    row.symbol = String(row.symbol || '').trim().toUpperCase();
    row.date = String(row.date || '').trim();
    row.candle_time_et = String(row.candle_time_et || '').trim();

    if (!row.symbol) continue;

    if (normalizeDateStr(row.date) === normalizedTargetDate) {
      rows.push(row);
    }
  }

  return rows;
}

function groupRowsBySymbol(rows) {
  const map = new Map();

  for (const row of rows) {
    const sym = String(row.symbol || '').trim().toUpperCase();
    if (!sym) continue;
    if (!map.has(sym)) map.set(sym, []);
    map.get(sym).push(row);
  }

  for (const [, arr] of map) {
    sortRows(arr);
  }

  return map;
}

function hitTpBeforeSl(futureCandles, refClose, tpPct, slPct) {
  if (!futureCandles.length || refClose <= 0) return 'neutral';

  const levelUp = refClose * (1 + tpPct);
  const levelDown = refClose * (1 - slPct);
  let prevClose = refClose;

  for (let j = 0; j < Math.min(120, futureCandles.length); j++) {
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
      } catch {
        reject(new Error(`Bad JSON: ${stdout}`));
      }
    });

    proc.stdin.write(JSON.stringify({ batch, _threshold: threshold }), () => proc.stdin.end());
  });
}

function buildPayloadsForSymbol(rows, fromMin, toMin) {
  const targetRows = [];

  for (let i = 0; i < rows.length; i++) {
    const t = String(rows[i].candle_time_et || '');
    const min = timeToMin(t);
    if (min >= fromMin && min <= toMin) {
      targetRows.push({ idx: i, row: rows[i], time: t });
    }
  }

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

  return { targetRows, payloads };
}

function summarizeTicker(symbol, rows, targetRows, results, tpDec, slDec) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  let wins = 0;
  let losses = 0;
  let neutrals = 0;
  let tradeSignals = 0;
  let pnl = 0;

  const firstTime = targetRows.length ? targetRows[0].time : '-';
  const lastTime = targetRows.length ? targetRows[targetRows.length - 1].time : '-';

  for (let i = 0; i < targetRows.length; i++) {
    const { idx, row } = targetRows[i];
    const pred = results[i] || {};
    const tradeable = !!pred.tradeable;

    const mfr = toNum(row.max_future_return_10m);
    const realGood = mfr >= tpDec;

    if (tradeable && realGood) tp++;
    else if (tradeable && !realGood) fp++;
    else if (!tradeable && realGood) fn++;
    else tn++;

    if (tradeable) {
      tradeSignals++;

      const futureCandles = rows.slice(idx + 1, idx + 121).map(rr => ({
        o: toNum(rr.open),
        h: toNum(rr.high),
        l: toNum(rr.low),
        c: toNum(rr.close),
      }));

      const result = hitTpBeforeSl(futureCandles, toNum(row.close), tpDec, slDec);

      if (result === 'win') {
        wins++;
        pnl += INVESTMENT * tpDec;
      } else if (result === 'loss') {
        losses++;
        pnl -= INVESTMENT * slDec;
      } else {
        neutrals++;
        pnl += INVESTMENT * mfr;
      }
    }
  }

  return {
    symbol,
    totalCandlesInWindow: targetRows.length,
    tradeSignals,
    wins,
    losses,
    neutrals,
    winRate: safeDiv(wins, wins + losses),
    precision: safeDiv(tp, tp + fp),
    recall: safeDiv(tp, tp + fn),
    accuracy: safeDiv(tp + tn, tp + fp + tn + fn),
    tp,
    fp,
    tn,
    fn,
    pnl,
    firstTime,
    lastTime,
  };
}

function printHeader(dateStr, fromTime, toTime, threshold, tpPct, slPct) {
  console.log('');
  console.log('═'.repeat(160));
  console.log(`📅 Fecha: ${normalizeDateStr(dateStr)} | ⏰ Ventana: ${fromTime}-${toTime} | 🎯 Threshold: ${threshold} | TP: ${tpPct}% | SL: ${slPct}% | $${INVESTMENT}/trade`);
  console.log('═'.repeat(160));
}

function printCompactHeader() {
  const hdr = [
    padRight('Ticker', 8),
    '|',
    padLeft('Estado', 18),
    '|',
    padLeft('Velas', 5),
    '|',
    padLeft('Señales', 7),
    '|',
    padLeft('Wins', 4),
    '|',
    padLeft('Loss', 4),
    '|',
    padLeft('Neutral', 7),
    '|',
    padLeft('WinRate', 8),
    '|',
    padLeft('P/L', 10),
    '|',
    'Detalle',
  ].join(' ');
  console.log('');
  console.log(hdr);
  console.log('─'.repeat(hdr.length));
}

function printOkLine(s) {
  console.log([
    padRight(s.symbol, 8),
    '|',
    padLeft('OK', 18),
    '|',
    padLeft(s.totalCandlesInWindow, 5),
    '|',
    padLeft(s.tradeSignals, 7),
    '|',
    padLeft(s.wins, 4),
    '|',
    padLeft(s.losses, 4),
    '|',
    padLeft(s.neutrals, 7),
    '|',
    padLeft(fmtPct(s.winRate), 8),
    '|',
    padLeft(fmtMoney(s.pnl), 10),
    '|',
    `${s.firstTime}-${s.lastTime}`,
  ].join(' '));
}

function printSkipLine(symbol, reason, detail = '') {
  console.log([
    padRight(symbol, 8),
    '|',
    padLeft(reason, 18),
    '|',
    padLeft('-', 5),
    '|',
    padLeft('-', 7),
    '|',
    padLeft('-', 4),
    '|',
    padLeft('-', 4),
    '|',
    padLeft('-', 7),
    '|',
    padLeft('-', 8),
    '|',
    padLeft('-', 10),
    '|',
    detail,
  ].join(' '));
}

function printGlobalSummary(dateStr, summaries, skipped) {
  const g = {
    tickersOk: summaries.length,
    tickersSkipped: skipped.length,
    totalCandlesInWindow: 0,
    tradeSignals: 0,
    wins: 0,
    losses: 0,
    neutrals: 0,
    tp: 0,
    fp: 0,
    tn: 0,
    fn: 0,
    pnl: 0,
  };

  for (const s of summaries) {
    g.totalCandlesInWindow += s.totalCandlesInWindow;
    g.tradeSignals += s.tradeSignals;
    g.wins += s.wins;
    g.losses += s.losses;
    g.neutrals += s.neutrals;
    g.tp += s.tp;
    g.fp += s.fp;
    g.tn += s.tn;
    g.fn += s.fn;
    g.pnl += s.pnl;
  }

  const skipByReason = skipped.reduce((acc, x) => {
    acc[x.reason] = (acc[x.reason] || 0) + 1;
    return acc;
  }, {});

  console.log('');
  console.log('═'.repeat(160));
  console.log(`🌎 RESUMEN GLOBAL | Fecha: ${normalizeDateStr(dateStr)}`);
  console.log('═'.repeat(160));
  console.log(`Tickers OK: ${g.tickersOk}`);
  console.log(`Tickers omitidos: ${g.tickersSkipped}`);
  console.log(`Motivos omitidos: ${Object.entries(skipByReason).map(([k, v]) => `${k}=${v}`).join(' | ') || 'ninguno'}`);
  console.log(`Velas en ventana: ${g.totalCandlesInWindow}`);
  console.log(`Señales: ${g.tradeSignals}`);
  console.log(`Wins: ${g.wins} | Losses: ${g.losses} | Neutrals: ${g.neutrals}`);
  console.log(`Win rate global: ${fmtPct(safeDiv(g.wins, g.wins + g.losses))}`);
  console.log(`Precision global: ${fmtPct(safeDiv(g.tp, g.tp + g.fp))}`);
  console.log(`Recall global: ${fmtPct(safeDiv(g.tp, g.tp + g.fn))}`);
  console.log(`Accuracy global: ${fmtPct(safeDiv(g.tp + g.tn, g.tp + g.fp + g.tn + g.fn))}`);
  console.log(`💰 P/L total global: ${fmtMoney(g.pnl)}`);
  console.log('═'.repeat(160));
}

async function main() {
  const csvPath = path.join(__dirname, '..', '..', 'stock-training', 'data', 'training-v2.csv');
  const rows = await loadCsvByDate(csvPath, dateStr);

  if (!rows || !rows.length) {
    console.error(`No data for date ${dateStr} in ${csvPath}`);
    process.exit(1);
  }

  const bySymbol = groupRowsBySymbol(rows);
  const symbols = Array.from(bySymbol.keys()).sort();

  const fromMin = timeToMin(fromTime);
  const toMin = timeToMin(toTime);
  const tpDec = TP_PCT / 100;
  const slDec = SL_PCT / 100;

  printHeader(dateStr, fromTime, toTime, THRESHOLD, TP_PCT, SL_PCT);
  printCompactHeader();

  const summaries = [];
  const skipped = [];

  for (const symbol of symbols) {
    const symRows = bySymbol.get(symbol) || [];
    const { targetRows, payloads } = buildPayloadsForSymbol(symRows, fromMin, toMin);

    if (!targetRows.length) {
      const firstRowTime = symRows.length ? symRows[0].candle_time_et : 'N/A';
      const lastRowTime = symRows.length ? symRows[symRows.length - 1].candle_time_et : 'N/A';

      console.log(
        `⚠️ IGNORADO ${symbol} en ${normalizeDateStr(dateStr)} -> ` +
        `motivo=NO_WINDOW | total_velas_dia=${symRows.length} | ` +
        `primer_time=${firstRowTime} | ultimo_time=${lastRowTime} | ` +
        `rango_buscado=${fromTime}-${toTime}`
      );

      skipped.push({ symbol, reason: 'SKIP_NO_WINDOW' });
      printSkipLine(symbol, 'SKIP_NO_WINDOW', `${symRows.length} velas fuera de rango`);
      continue;
    }

    let results;
    try {
      results = await callPredictBatch(payloads, THRESHOLD);
    } catch (e) {
      console.log(
        `⚠️ IGNORADO ${symbol} en ${normalizeDateStr(dateStr)} -> ` +
        `motivo=PREDICT_ERROR | velas_en_ventana=${targetRows.length} | ` +
        `error=${String(e.message || e).slice(0, 220)}`
      );

      skipped.push({ symbol, reason: 'SKIP_PREDICT_ERR' });
      printSkipLine(symbol, 'SKIP_PREDICT_ERR', String(e.message || '').slice(0, 80));
      continue;
    }

    const summary = summarizeTicker(symbol, symRows, targetRows, results, tpDec, slDec);
    summaries.push(summary);
    printOkLine(summary);
  }

  printGlobalSummary(dateStr, summaries, skipped);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});