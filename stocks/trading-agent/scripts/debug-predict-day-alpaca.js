#!/usr/bin/env node

/**
 * Debug day prediction from top_gainers.json + Alpaca
 *
 * Usage:
 *   node debug-predict-day-alpaca.js 2026-03-19
 *   node debug-predict-day-alpaca.js 2026-03-19 09:30 11:00 0.6 4 2
 *
 * Args:
 *   0: date (YYYY-MM-DD)
 *   1: fromTime (HH:mm)      -> America/New_York
 *   2: toTime (HH:mm)        -> America/New_York
 *   3: threshold             -> e.g. 0.6
 *   4: take profit percent   -> e.g. 4
 *   5: stop loss percent     -> e.g. 2
 *
 * Input file:
 *   ./top_gainers.json
 *
 * IMPORTANT:
 * - This file computes all row features internally.
 * - For each row, features use only data available up to that candle.
 * - Labels intentionally use future candles.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');

const MARKET_OPEN = '09:30';
const INVESTMENT = 200;
const NY_TZ = 'America/New_York';
const REGULAR_OPEN_MIN = 9 * 60 + 30;

// Prefer environment variables; keep fallback only if you really want it
const APCA_API_KEY_ID =
  process.env.APCA_API_KEY_ID || 'AKAS3FTVF54TKVHQSOO44I5XJH';
const APCA_API_SECRET_KEY =
  process.env.APCA_API_SECRET_KEY || 'Br5quiybxDxEhw2WsX1EhHMq83f4TZX4RAhoxzkdQG2d';

const args = process.argv.slice(2).filter(a => a !== '--');

const dateStr = args[0];
const fromTime = args[1] || MARKET_OPEN;
const toTime = args[2] || '11:00';
const THRESHOLD = parseFloat(args[3]) || 0.7;
const TP_PCT = parseFloat(args[4]) || 4;
const SL_PCT = parseFloat(args[5]) || 2;

const topGainersPath = path.resolve(__dirname, '..', '..', 'stock-training', 'data', 'top_gainers.json');
const stockTraining = path.resolve(__dirname, '..', '..', 'stock-training');
const predictBatchScript = path.join(stockTraining, 'ml', 'experiments', 'predict_batch.py');

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function timeToMin(t) {
  const [h = '0', m = '0'] = String(t).split(':');
  return Number(h) * 60 + Number(m);
}

function parseGmtOffsetToMinutes(offsetText) {
  const match = String(offsetText).match(/([A-Z]+)([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return -300;
  const sign = match[2] === '-' ? -1 : 1;
  const hours = Number(match[3] || 0);
  const mins = Number(match[4] || 0);
  return sign * (hours * 60 + mins);
}

function getNyOffsetMinutes(date, time = '12:00:00') {
  const approxUtc = new Date(`${date}T${time}Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    timeZoneName: 'shortOffset',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(approxUtc);

  const tzName = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-5';
  return parseGmtOffsetToMinutes(tzName);
}

function nyLocalToUtcIso(date, time = '00:00:00') {
  const [year, month, day] = date.split('-').map(Number);
  const [hh, mm, ss = '00'] = time.split(':');
  const offsetMinutes = getNyOffsetMinutes(date, time);

  const utcMs =
    Date.UTC(year, month - 1, day, Number(hh), Number(mm), Number(ss)) -
    (offsetMinutes * 60 * 1000);

  return new Date(utcMs).toISOString();
}

function utcToNyDateTimeParts(isoUtc) {
  const d = new Date(isoUtc);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);

  const get = type => parts.find(p => p.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
    timeSec: `${get('hour')}:${get('minute')}:${get('second')}`,
  };
}

function toNum(v) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safePctRatio(n, d) {
  return d > 0 ? n / d : 0;
}

function sma(values, period, idx) {
  if (idx + 1 < period) return 0;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += values[i];
  return sum / period;
}

function computeEMA(values, period) {
  const out = new Array(values.length).fill(0);
  if (!values.length) return out;

  const k = 2 / (period + 1);

  // Seed with SMA(period) if enough data, otherwise first value
  if (values.length < period) {
    let prev = values[0] || 0;
    out[0] = prev;
    for (let i = 1; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  seed /= period;

  for (let i = 0; i < period - 1; i++) out[i] = 0;
  out[period - 1] = seed;

  let prev = seed;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }

  return out;
}

function computeATR(rows, period = 14) {
  const tr = new Array(rows.length).fill(0);
  const atr = new Array(rows.length).fill(0);

  for (let i = 0; i < rows.length; i++) {
    const h = toNum(rows[i].high);
    const l = toNum(rows[i].low);
    const prevClose = i > 0 ? toNum(rows[i - 1].close) : toNum(rows[i].close);

    const tr1 = h - l;
    const tr2 = Math.abs(h - prevClose);
    const tr3 = Math.abs(l - prevClose);
    tr[i] = Math.max(tr1, tr2, tr3);
  }

  for (let i = 0; i < rows.length; i++) {
    if (i === 0) {
      atr[i] = tr[i];
    } else if (i < period) {
      atr[i] = sma(tr, i + 1, i);
    } else if (i === period) {
      atr[i] = sma(tr, period, i);
    } else {
      atr[i] = ((atr[i - 1] * (period - 1)) + tr[i]) / period;
    }
  }

  return atr;
}

function computeRSI(closes, period = 14) {
  const rsi = new Array(closes.length).fill(0);
  if (closes.length < 2) return rsi;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= Math.min(period, closes.length - 1); i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = 1; i < closes.length; i++) {
    if (i > period) {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      avgGain = ((avgGain * (period - 1)) + gain) / period;
      avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    }

    if (i < period) {
      rsi[i] = 0;
      continue;
    }

    if (avgLoss === 0) {
      rsi[i] = 100;
      continue;
    }

    const rs = avgGain / avgLoss;
    rsi[i] = 100 - (100 / (1 + rs));
  }

  return rsi;
}

function stddev(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, x) => acc + ((x - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function getSession(minute) {
  return minute < 570 ? 'PRE_MARKET'
    : minute < 600 ? 'THE_OPEN'
    : minute < 690 ? 'LATE_MORNING'
    : minute < 900 ? 'MIDDAY'
    : minute < 960 ? 'THE_CLOSE'
    : 'AFTER_HOURS';
}

// ──────────────────────────────────────────────────────────────────────────────
// IO
// ──────────────────────────────────────────────────────────────────────────────
function loadTopGainers(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`top_gainers.json not found at: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error(`top_gainers.json must contain an array`);
  }

  return data;
}

// ──────────────────────────────────────────────────────────────────────────────
// Alpaca
// ──────────────────────────────────────────────────────────────────────────────
async function fetchBarsFromAlpaca(symbol, nyDate) {
  const startUtc = nyLocalToUtcIso(nyDate, '00:00:00');
  const endUtc = nyLocalToUtcIso(nyDate, '23:59:59');

  const url =
    `https://data.alpaca.markets/v2/stocks/bars` +
    `?symbols=${encodeURIComponent(symbol)}` +
    `&timeframe=1Min` +
    `&start=${encodeURIComponent(startUtc)}` +
    `&end=${encodeURIComponent(endUtc)}` +
    `&adjustment=split` +
    `&sort=asc` +
    `&limit=10000`;

  const response = await axios.request({
    method: 'get',
    maxBodyLength: Infinity,
    url,
    headers: {
      'APCA-API-KEY-ID': APCA_API_KEY_ID,
      'APCA-API-SECRET-KEY': APCA_API_SECRET_KEY,
    },
  });

  return response?.data?.bars?.[symbol] || [];
}

// ──────────────────────────────────────────────────────────────────────────────
// Features + Labels
// ──────────────────────────────────────────────────────────────────────────────
function buildRowsFromBars(symbol, nyDate, bars) {
  if (!bars.length) return [];

  const normalized = bars
    .map((b) => {
      const p = utcToNyDateTimeParts(b.t);
      return {
        symbol,
        date: p.date,
        candle_time_et: p.time,
        open: toNum(b.o),
        high: toNum(b.h),
        low: toNum(b.l),
        close: toNum(b.c),
        volume: toNum(b.v),
        rawTime: b.t,
      };
    })
    .filter(r => r.date === nyDate)
    .sort((a, b) => new Date(a.rawTime) - new Date(b.rawTime));

  if (!normalized.length) return [];

  const closes = normalized.map(r => r.close);
  const volumes = normalized.map(r => r.volume);

  const ema9 = computeEMA(closes, 9);
  const ema20 = computeEMA(closes, 20);
  const atr = computeATR(normalized, 14);
  const rsi = computeRSI(closes, 14);

  const firstRegularIndex = normalized.findIndex(r => timeToMin(r.candle_time_et) >= REGULAR_OPEN_MIN);
  const openDay = normalized[0]?.open || 0;
  const openFirst = firstRegularIndex >= 0 ? normalized[firstRegularIndex].open : openDay;

  const rows = [];
  let cumulativeTypicalPV = 0;
  let cumulativeVol = 0;

  let highOfDaySoFar = -Infinity;
  let lowOfDaySoFar = Infinity;
  let preMarketHighSoFar = 0;
  let premarketVolumeSoFar = 0;
  let hodIndex = -1;

  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i];
    const minute = timeToMin(row.candle_time_et);
    const isPremarket = minute < REGULAR_OPEN_MIN;
    const prevHighOfDay = Number.isFinite(highOfDaySoFar) ? highOfDaySoFar : 0;

    const typicalPrice = (row.high + row.low + row.close) / 3;
    cumulativeTypicalPV += typicalPrice * row.volume;
    cumulativeVol += row.volume;

    // Pre-market aggregates must be "so far" only
    if (isPremarket) {
      preMarketHighSoFar = Math.max(preMarketHighSoFar, row.high);
      premarketVolumeSoFar += row.volume;
    }

    // HOD / LOD must be "so far" only
    if (row.high >= highOfDaySoFar) {
      highOfDaySoFar = row.high;
      hodIndex = i;
    }
    lowOfDaySoFar = Math.min(lowOfDaySoFar, row.low);

    const prevClose = i >= 1 ? normalized[i - 1].close : row.close;
    const prev5 = i >= 5 ? normalized[i - 5].close : 0;
    const prev10 = i >= 10 ? normalized[i - 10].close : 0;

    const dollarVolume = row.close * row.volume;

    const volumeAvg20 = i >= 19
      ? volumes.slice(i - 19, i + 1).reduce((a, b) => a + b, 0) / 20
      : volumes.slice(0, i + 1).reduce((a, b) => a + b, 0) / Math.max(1, i + 1);

    const dollarVolAvg20 = i >= 19
      ? rows.slice(i - 19, i).reduce((sum, item) => sum + item.dollar_volume, 0) / 19
      : rows.slice(0, i).reduce((sum, item) => sum + item.dollar_volume, 0) / Math.max(1, i);

    const ret1 = i >= 1 && normalized[i - 1].close > 0 ? (row.close / normalized[i - 1].close) - 1 : 0;
    const ret2 = i >= 2 && normalized[i - 2].close > 0 ? (row.close / normalized[i - 2].close) - 1 : 0;
    const ret3 = i >= 3 && normalized[i - 3].close > 0 ? (row.close / normalized[i - 3].close) - 1 : 0;

    const vol15 = i >= 14
      ? stddev(
          normalized.slice(i - 14, i + 1).map((r, idx, arr) => {
            if (idx === 0) return 0;
            return arr[idx - 1].close > 0 ? (r.close / arr[idx - 1].close) - 1 : 0;
          })
        )
      : 0;

    const vwap = cumulativeVol > 0 ? cumulativeTypicalPV / cumulativeVol : 0;

    const gapPct = (!isPremarket && openFirst > 0 && openDay > 0)
      ? (openFirst - openDay) / openDay
      : 0;

    rows.push({
      symbol,
      date: row.date,
      candle_time_et: row.candle_time_et,
      candle_idx: i,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,

      atr: atr[i] || 0,
      vwap,
      high_of_day: highOfDaySoFar,
      low_of_day: lowOfDaySoFar,
      change_pct_at_candle: openDay > 0 ? (row.close - openDay) / openDay : 0,
      ema9: ema9[i] || 0,
      ema20: ema20[i] || 0,
      pre_market_high: preMarketHighSoFar,
      session: getSession(minute),

      shares_outstanding: 0,
      market_cap: 0,
      gap_pct: gapPct,
      premarket_volume: premarketVolumeSoFar,

      momentum_acumulado: openDay > 0 ? (row.close - openDay) / openDay : 0,
      change_1m: prevClose > 0 ? (row.close - prevClose) / prevClose : 0,
      change_5m: prev5 > 0 ? (row.close - prev5) / prev5 : 0,
      change_10m: prev10 > 0 ? (row.close - prev10) / prev10 : 0,
      minutes_since_hod: hodIndex >= 0 ? i - hodIndex : 0,
      volume_rel: volumeAvg20 > 0 ? row.volume / volumeAvg20 : 0,
      dist_vwap_pct: vwap > 0 ? (row.close - vwap) / vwap : 0,
      atr_rel: row.close > 0 ? (atr[i] || 0) / row.close : 0,
      minute_of_day: minute,
      rsi: rsi[i] || 0,
      volatility_15m: vol15,

      mom_5: prev5 > 0 ? (row.close / prev5) - 1 : 0,
      mom_10: prev10 > 0 ? (row.close / prev10) - 1 : 0,
      return_lag_1: ret1,
      return_lag_2: ret2,
      return_lag_3: ret3,

      dist_hod_pct: highOfDaySoFar > 0 ? (row.close - highOfDaySoFar) / highOfDaySoFar : 0,
      dist_lod_pct: lowOfDaySoFar > 0 ? (row.close - lowOfDaySoFar) / lowOfDaySoFar : 0,
      dist_pm_high: preMarketHighSoFar > 0 ? (row.close - preMarketHighSoFar) / preMarketHighSoFar : 0,

      // Compare against prior HOD, not HOD that already includes current bar
      break_hod: prevHighOfDay > 0 && row.high > prevHighOfDay ? 1 : 0,
      break_pm_high: preMarketHighSoFar > 0 && row.high > preMarketHighSoFar ? 1 : 0,

      range_expansion: row.open > 0 ? (row.high - row.low) / row.open : 0,
      float_rotation: 0,
      dollar_volume: dollarVolume,
      relative_dollar_volume: dollarVolAvg20 > 0 ? dollarVolume / dollarVolAvg20 : 0,
      volume_spike: volumeAvg20 > 0 && row.volume >= volumeAvg20 * 2 ? 1 : 0,
      vwap_cross_up: i > 0 && rows[i - 1].close < rows[i - 1].vwap && row.close >= vwap ? 1 : 0,
      dist_ema9: ema9[i] > 0 ? (row.close - ema9[i]) / ema9[i] : 0,
      dist_ema20: ema20[i] > 0 ? (row.close - ema20[i]) / ema20[i] : 0,

      // acceleration = current 1m return - previous 1m return
      momentum_acceleration:
        i >= 2 && normalized[i - 1].close > 0 && normalized[i - 2].close > 0
          ? ((row.close - normalized[i - 1].close) / normalized[i - 1].close) -
            ((normalized[i - 1].close - normalized[i - 2].close) / normalized[i - 2].close)
          : 0,

      is_open: minute >= 570 && minute < 600 ? 1 : 0,
      is_midday: minute >= 690 && minute < 900 ? 1 : 0,
      is_power_hour: minute >= 900 && minute <= 960 ? 1 : 0,
      dist_gap: gapPct,
      relative_range: row.close > 0 ? (row.high - row.low) / row.close : 0,

      // labels filled below
      future_return_5m: 0,
      target: 0,
      target_break_hod_5m: 0,
      max_future_return_10m: 0,
    });
  }

  // Labels intentionally use future data
  for (let i = 0; i < rows.length; i++) {
    const refClose = rows[i].close;
    const future5 = rows.slice(i + 1, i + 6);
    const future10 = rows.slice(i + 1, i + 11);

    const close5 = future5.length ? future5[future5.length - 1].close : refClose;
    const maxHigh10 = future10.length ? Math.max(...future10.map(r => r.high)) : refClose;

    rows[i].future_return_5m = refClose > 0 ? ((close5 - refClose) / refClose) : 0;
    rows[i].max_future_return_10m = refClose > 0 ? ((maxHigh10 - refClose) / refClose) : 0;
    rows[i].target = rows[i].future_return_5m > 0 ? 1 : 0;

    // Compare future highs against HOD BEFORE current candle
    const priorHod = i > 0 ? rows[i - 1].high_of_day : 0;
    rows[i].target_break_hod_5m =
      priorHod > 0 && future5.some(r => r.high > priorHod) ? 1 : 0;
  }

  return rows;
}

// ──────────────────────────────────────────────────────────────────────────────
// TP/SL
// ──────────────────────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────────────────
// predict_batch.py
// ──────────────────────────────────────────────────────────────────────────────
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

// ──────────────────────────────────────────────────────────────────────────────
// Per ticker
// ──────────────────────────────────────────────────────────────────────────────
async function processTicker(symbol, dateStr, fromTime, toTime, threshold, tpPct, slPct) {
  const bars = await fetchBarsFromAlpaca(symbol, dateStr);
  if (!bars.length) {
    return {
      symbol,
      status: 'no_bars',
      totalRows: 0,
      windowRows: 0,
      totalTrades: 0,
      totalWins: 0,
      totalLosses: 0,
      totalNeutral: 0,
      winRate: 0,
      lossRate: 0,
      precision: 0,
      recall: 0,
      accuracy: 0,
      pnl: 0,
      tp: 0,
      fp: 0,
      tn: 0,
      fn: 0,
    };
  }

  const rows = buildRowsFromBars(symbol, dateStr, bars);
  if (!rows.length) {
    return {
      symbol,
      status: 'no_rows',
      totalRows: 0,
      windowRows: 0,
      totalTrades: 0,
      totalWins: 0,
      totalLosses: 0,
      totalNeutral: 0,
      winRate: 0,
      lossRate: 0,
      precision: 0,
      recall: 0,
      accuracy: 0,
      pnl: 0,
      tp: 0,
      fp: 0,
      tn: 0,
      fn: 0,
    };
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
    return {
      symbol,
      status: 'no_window_rows',
      totalRows: rows.length,
      windowRows: 0,
      totalTrades: 0,
      totalWins: 0,
      totalLosses: 0,
      totalNeutral: 0,
      winRate: 0,
      lossRate: 0,
      precision: 0,
      recall: 0,
      accuracy: 0,
      pnl: 0,
      tp: 0,
      fp: 0,
      tn: 0,
      fn: 0,
    };
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

      // already built as past-only features
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

  const results = await callPredictBatch(payloads, threshold);

  const tpDec = tpPct / 100;
  const slDec = slPct / 100;

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let cumPnL = 0;

  let totalTrades = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalNeutral = 0;

  for (let i = 0; i < targetRows.length; i++) {
    const { idx, row } = targetRows[i];
    const r = results[i] || {};
    const tradeable = r.tradeable || false;

    const mfr = toNum(row.max_future_return_10m);
    const realGood = mfr >= tpDec;

    const futureCandles = rows.slice(idx + 1, idx + 11).map(x => ({
      o: toNum(x.open),
      h: toNum(x.high),
      l: toNum(x.low),
      c: toNum(x.close),
    }));

    const tpSlResult = hitTpBeforeSl(futureCandles, toNum(row.close), tpDec, slDec);

    if (tradeable && realGood) tp++;
    else if (tradeable && !realGood) fp++;
    else if (!tradeable && realGood) fn++;
    else tn++;

    let pnl = 0;
    if (tradeable) {
      totalTrades++;

      if (tpSlResult === 'win') totalWins++;
      else if (tpSlResult === 'loss') totalLosses++;
      else totalNeutral++;

      if (tpSlResult === 'win') pnl = INVESTMENT * tpDec;
      else if (tpSlResult === 'loss') pnl = -INVESTMENT * slDec;
      else pnl = INVESTMENT * mfr;
    }

    cumPnL += pnl;
  }

  const total = tp + fp + tn + fn;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const accuracy = total > 0 ? (tp + tn) / total : 0;

  const decidedTrades = totalWins + totalLosses;
  const winRate = decidedTrades > 0 ? (totalWins / decidedTrades) * 100 : 0;
  const lossRate = decidedTrades > 0 ? (totalLosses / decidedTrades) * 100 : 0;

  return {
    symbol,
    status: 'ok',
    totalRows: rows.length,
    windowRows: targetRows.length,
    totalTrades,
    totalWins,
    totalLosses,
    totalNeutral,
    winRate,
    lossRate,
    precision: precision * 100,
    recall: recall * 100,
    accuracy: accuracy * 100,
    pnl: cumPnL,
    tp,
    fp,
    tn,
    fn,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!dateStr) {
    console.error('Usage: node debug-predict-day-alpaca.js DATE [fromTime] [toTime] [threshold] [tpPct] [slPct]');
    console.error('Example: node debug-predict-day-alpaca.js 2026-03-19 09:30 11:00 0.6 4 2');
    process.exit(1);
  }

  const gainers = loadTopGainers(topGainersPath);
  const dayItems = gainers.filter(x => String(x.Date || '') === dateStr);

  if (!dayItems.length) {
    console.error(`No entries found in top_gainers.json for date ${dateStr}`);
    process.exit(1);
  }

  const uniqueSymbols = [...new Set(
    dayItems
      .map(x => String(x.symbol || '').toUpperCase().trim())
      .filter(Boolean)
  )];

  console.log(`\n📅 Day Debug Predict: ${dateStr} | ${fromTime}–${toTime}`);
  console.log(`Threshold=${THRESHOLD} | TP=${TP_PCT}% | SL=${SL_PCT}% | Investment=$${INVESTMENT}`);
  console.log(`top_gainers.json matches: ${dayItems.length} | unique symbols: ${uniqueSymbols.length}`);
  console.log('═'.repeat(120));

  const summaries = [];

  for (let i = 0; i < uniqueSymbols.length; i++) {
    const symbol = uniqueSymbols[i];
    console.log(`\n[${i + 1}/${uniqueSymbols.length}] Processing ${symbol}...`);

    try {
      const summary = await processTicker(
        symbol,
        dateStr,
        fromTime,
        toTime,
        THRESHOLD,
        TP_PCT,
        SL_PCT
      );

      summaries.push(summary);

      if (summary.status !== 'ok') {
        console.log(`  status=${summary.status}`);
        continue;
      }

      console.log(
        `  trades=${summary.totalTrades} | win=${summary.totalWins} | loss=${summary.totalLosses} | neutral=${summary.totalNeutral}` +
        ` | winRate=${summary.winRate.toFixed(2)}% | pnl=${summary.pnl >= 0 ? '+' : ''}$${summary.pnl.toFixed(2)}`
      );
    } catch (e) {
      summaries.push({
        symbol,
        status: 'error',
        error: e.message,
        totalRows: 0,
        windowRows: 0,
        totalTrades: 0,
        totalWins: 0,
        totalLosses: 0,
        totalNeutral: 0,
        winRate: 0,
        lossRate: 0,
        precision: 0,
        recall: 0,
        accuracy: 0,
        pnl: 0,
        tp: 0,
        fp: 0,
        tn: 0,
        fn: 0,
      });

      console.log(`  error=${e.message}`);
    }
  }

  const ok = summaries.filter(x => x.status === 'ok');
  const skipped = summaries.filter(x => x.status !== 'ok');

  let aggTrades = 0;
  let aggWins = 0;
  let aggLosses = 0;
  let aggNeutral = 0;
  let aggPnL = 0;
  let aggTP = 0;
  let aggFP = 0;
  let aggTN = 0;
  let aggFN = 0;

  for (const s of ok) {
    aggTrades += s.totalTrades;
    aggWins += s.totalWins;
    aggLosses += s.totalLosses;
    aggNeutral += s.totalNeutral;
    aggPnL += s.pnl;
    aggTP += s.tp;
    aggFP += s.fp;
    aggTN += s.tn;
    aggFN += s.fn;
  }

  const totalConf = aggTP + aggFP + aggTN + aggFN;
  const aggPrecision = aggTP + aggFP > 0 ? (aggTP / (aggTP + aggFP)) * 100 : 0;
  const aggRecall = aggTP + aggFN > 0 ? (aggTP / (aggTP + aggFN)) * 100 : 0;
  const aggAccuracy = totalConf > 0 ? ((aggTP + aggTN) / totalConf) * 100 : 0;
  const aggDecided = aggWins + aggLosses;
  const aggWinRate = aggDecided > 0 ? (aggWins / aggDecided) * 100 : 0;
  const aggLossRate = aggDecided > 0 ? (aggLosses / aggDecided) * 100 : 0;

  console.log('\n');
  console.log('═'.repeat(140));
  console.log('SUMMARY BY TICKER');
  console.log('═'.repeat(140));

  const header = [
    'Symbol'.padEnd(8),
    'Status'.padEnd(12),
    'Trades'.padStart(8),
    'Win'.padStart(6),
    'Loss'.padStart(6),
    'Neutral'.padStart(8),
    'WinRate'.padStart(10),
    'Precision'.padStart(10),
    'Recall'.padStart(9),
    'Accuracy'.padStart(10),
    'P/L'.padStart(12),
  ].join(' | ');

  console.log(header);
  console.log('─'.repeat(header.length));

  for (const s of summaries) {
    console.log([
      String(s.symbol || '').padEnd(8),
      String(s.status || '').padEnd(12),
      String(s.totalTrades || 0).padStart(8),
      String(s.totalWins || 0).padStart(6),
      String(s.totalLosses || 0).padStart(6),
      String(s.totalNeutral || 0).padStart(8),
      `${toNum(s.winRate).toFixed(2)}%`.padStart(10),
      `${toNum(s.precision).toFixed(2)}%`.padStart(10),
      `${toNum(s.recall).toFixed(2)}%`.padStart(9),
      `${toNum(s.accuracy).toFixed(2)}%`.padStart(10),
      `${s.pnl >= 0 ? '+' : ''}$${toNum(s.pnl).toFixed(2)}`.padStart(12),
    ].join(' | '));
  }

  console.log('\n' + '═'.repeat(140));
  console.log(`DAY TOTAL: ${dateStr}`);
  console.log('═'.repeat(140));

  console.log(`Tickers in file for day: ${uniqueSymbols.length}`);
  console.log(`Processed ok: ${ok.length}`);
  console.log(`Skipped/error: ${skipped.length}`);

  console.log('');
  console.log(`Total trades: ${aggTrades}`);
  console.log(`Total win: ${aggWins}`);
  console.log(`Total loss: ${aggLosses}`);
  console.log(`Total neutral: ${aggNeutral}`);
  console.log(`Win rate: ${aggWinRate.toFixed(2)}%`);
  console.log(`Loss rate: ${aggLossRate.toFixed(2)}%`);

  console.log('');
  console.log(`Confusion: TP=${aggTP}  FP=${aggFP}  TN=${aggTN}  FN=${aggFN}`);
  console.log(`Precision: ${aggPrecision.toFixed(2)}%`);
  console.log(`Recall: ${aggRecall.toFixed(2)}%`);
  console.log(`Accuracy: ${aggAccuracy.toFixed(2)}%`);

  console.log(`\n💰 Inversión $${INVESTMENT}/trade → P/L total del día: ${aggPnL >= 0 ? '+' : ''}$${aggPnL.toFixed(2)}`);
}

main().catch(e => {
  console.error(e?.response?.data || e.message || e);
  process.exit(1);
});