#!/usr/bin/env node

const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

//node debug-predict-screener 2026-03-25 09:30 11:30 0.65 4 2
const BASE_URL = process.env.BASE_URL || 'http://localhost:3033';
const MARKET_OPEN = '09:30';
const INVESTMENT = 200;
const DEFAULT_BATCH_SIZE = 50;

const args = process.argv.slice(2).filter((a) => a !== '--');
const dateStr = args[0] || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const fromTime = args[1] || MARKET_OPEN;
const toTime = args[2] || '11:00';
const THRESHOLD = parseFloat(args[3]) || 0.7;
const TP_PCT = parseFloat(args[4]) || 4;
const SL_PCT = parseFloat(args[5]) || 2;
const BATCH_SIZE = parseInt(args[6], 10) || DEFAULT_BATCH_SIZE;

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 120000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

function toNum(v) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function toNullableNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
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

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function pickTimeEt(row) {
  return String(
    row.candle_time_et ??
    row.time ??
    row.candleTimeEt ??
    row.time_et ??
    row.timeET ??
    ''
  ).trim();
}

function pickSymbol(row) {
  return String(
    row.symbol ??
    row.ticker ??
    ''
  ).trim().toUpperCase();
}

function sortRows(rows) {
  rows.sort((a, b) => {
    const ta = timeToMin(pickTimeEt(a));
    const tb = timeToMin(pickTimeEt(b));
    if (ta !== tb) return ta - tb;
    return toNum(a.candle_idx) - toNum(b.candle_idx);
  });
}

function normalizeRow(raw, fallbackSymbol, fallbackDate) {
  const symbol = pickSymbol(raw) || String(fallbackSymbol || '').trim().toUpperCase();
  const candle_time_et = pickTimeEt(raw);

  return {
    symbol,
    date: normalizeDateStr(raw.date || fallbackDate),
    candle_time_et,
    candle_idx: toNum(raw.candle_idx),
    open: toNum(raw.open),
    high: toNum(raw.high),
    low: toNum(raw.low),
    close: toNum(raw.close),
    volume: toNum(raw.volume),

    atr: toNum(raw.atr),
    vwap: toNum(raw.vwap),
    high_of_day: toNum(raw.high_of_day),
    low_of_day: toNum(raw.low_of_day),
    change_pct_at_candle: toNum(raw.change_pct_at_candle),
    ema9: toNum(raw.ema9),
    ema20: toNum(raw.ema20),
    pre_market_high: toNum(raw.pre_market_high),
    session: String(raw.session || ''),

    shares_outstanding: toNum(raw.shares_outstanding),
    market_cap: toNum(raw.market_cap),
    gap_pct: toNum(raw.gap_pct),
    premarket_volume: toNum(raw.premarket_volume),

    max_future_return_10m: toNum(raw.max_future_return_10m),
  };
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

    proc.stdout.on('data', (c) => { stdout += c; });
    proc.stderr.on('data', (c) => { stderr += c; });

    proc.on('close', (code) => {
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

async function fetchCombinedSymbols() {
  const res = await http.get('/screener/combined');
  const data = res.data;

  if (!Array.isArray(data)) {
    throw new Error(`Respuesta inválida de /screener/combined: esperaba array`);
  }

  const seen = new Set();
  const symbols = [];

  for (const item of data) {
    const sym = String(item || '').trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    symbols.push(sym);
  }

  return symbols;
}

async function fetchTodayCandlesForSymbols(symbols) {
  if (!symbols.length) return [];

  const allRows = [];
  const chunks = chunkArray(symbols, BATCH_SIZE);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    console.log(`📡 Fetch features ${i + 1}/${chunks.length} | symbols=${chunk.length}`);

    const res = await http.post('/collector/features/today-candles', {
      symbols: chunk,
    });

    const body = res.data;
    if (!body || body.ok !== true || !Array.isArray(body.results)) {
      throw new Error(`Respuesta inválida de /collector/features/today-candles`);
    }

    const responseDate = normalizeDateStr(body.date || dateStr);

    for (let idx = 0; idx < body.results.length; idx++) {
      const resultItem = body.results[idx] || {};
      const fallbackSymbol = chunk[idx];

      const rows = Array.isArray(resultItem.rows) ? resultItem.rows : [];
      if (!rows.length) continue;

      for (const rawRow of rows) {
        const row = normalizeRow(rawRow, fallbackSymbol, responseDate);
        if (!row.symbol) continue;
        allRows.push(row);
      }
    }
  }

  return allRows;
}

function buildPayloadsForSymbol(rows, fromMin, toMin) {
  const targetRows = [];

  for (let i = 0; i < rows.length; i++) {
    const t = pickTimeEt(rows[i]);
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

  const allCandleTimesEt = rows.map((r) => pickTimeEt(r) || '09:30');
  const allCandleIdxArr = rows.map((r) => toNum(r.candle_idx));

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

      const futureCandles = rows.slice(idx + 1, idx + 11).map((rr) => ({
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

function printHeader(dateStr, fromTime, toTime, threshold, tpPct, slPct, baseUrl) {
  console.log('');
  console.log('═'.repeat(170));
  console.log(
    `📅 Fecha: ${normalizeDateStr(dateStr)} | ⏰ Ventana: ${fromTime}-${toTime} | ` +
    `🎯 Threshold: ${threshold} | TP: ${tpPct}% | SL: ${slPct}% | ` +
    `$${INVESTMENT}/trade | 🌐 ${baseUrl}`
  );
  console.log('═'.repeat(170));
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
  console.log('═'.repeat(170));
  console.log(`🌎 RESUMEN GLOBAL | Fecha: ${normalizeDateStr(dateStr)}`);
  console.log('═'.repeat(170));
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
  console.log('═'.repeat(170));
}

async function main() {
  const normalizedDate = normalizeDateStr(dateStr);
  const fromMin = timeToMin(fromTime);
  const toMin = timeToMin(toTime);
  const tpDec = TP_PCT / 100;
  const slDec = SL_PCT / 100;

  printHeader(normalizedDate, fromTime, toTime, THRESHOLD, TP_PCT, SL_PCT, BASE_URL);

  const symbols = await fetchCombinedSymbols();
  if (!symbols.length) {
    throw new Error('No llegaron símbolos de /screener/combined');
  }

  console.log(`🧾 Símbolos activos recibidos: ${symbols.length}`);

  const rows = await fetchTodayCandlesForSymbols(symbols);
  if (!rows.length) {
    throw new Error('No llegaron rows desde /collector/features/today-candles');
  }

  const rowsForDate = rows.filter((r) => normalizeDateStr(r.date) === normalizedDate);
  if (!rowsForDate.length) {
    throw new Error(`No hay rows para la fecha ${normalizedDate}`);
  }

  const bySymbol = groupRowsBySymbol(rowsForDate);
  const orderedSymbols = Array.from(new Set(symbols.map((s) => String(s).trim().toUpperCase())));

  printCompactHeader();

  const summaries = [];
  const skipped = [];

  for (const symbol of orderedSymbols) {
    const symRows = bySymbol.get(symbol) || [];

    if (!symRows.length) {
      console.log(
        `⚠️ IGNORADO ${symbol} en ${normalizedDate} -> ` +
        `motivo=NO_ROWS | endpoint no devolvió rows para ese símbolo`
      );
      skipped.push({ symbol, reason: 'SKIP_NO_ROWS' });
      printSkipLine(symbol, 'SKIP_NO_ROWS', 'sin rows');
      continue;
    }

    const { targetRows, payloads } = buildPayloadsForSymbol(symRows, fromMin, toMin);

    if (!targetRows.length) {
      const firstRowTime = symRows.length ? pickTimeEt(symRows[0]) : 'N/A';
      const lastRowTime = symRows.length ? pickTimeEt(symRows[symRows.length - 1]) : 'N/A';

      console.log(
        `⚠️ IGNORADO ${symbol} en ${normalizedDate} -> ` +
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
        `⚠️ IGNORADO ${symbol} en ${normalizedDate} -> ` +
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

  printGlobalSummary(normalizedDate, summaries, skipped);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});