#!/usr/bin/env node

/**
 * Debug: predict candle-by-candle from Alpaca instead of CSV.
 *
 * Usage:
 *   node debug-predict-alpaca.js MDAI 2026-03-19
 *   node debug-predict-alpaca.js MDAI 2026-03-19 09:30 11:00 0.6 4 2
 *
 * Args:
 *   0: ticker
 *   1: date (YYYY-MM-DD)                -> fecha NY en que se busca el ticker
 *   2: fromTime (HH:mm)                 -> start en America/New_York
 *   3: toTime (HH:mm)                   -> end en America/New_York
 *   4: threshold                        -> ej 0.6
 *   5: take profit percent              -> ej 4
 *   6: stop loss percent                -> ej 2
 *
 * Defaults:
 *   fromTime=09:30, toTime=11:00, threshold=0.7, TP=4, SL=2
 */

const fs = require('fs');
const axios = require('axios');
const { spawn } = require('child_process');
const path = require('path');

const MARKET_OPEN = '09:30';
const INVESTMENT = 200;
const NY_TZ = 'America/New_York';
const REGULAR_OPEN_MIN = 9 * 60 + 30;

// Hardcoded exactly as requested
const APCA_API_KEY_ID = 'AKAS3FTVF54TKVHQSOO44I5XJH';
const APCA_API_SECRET_KEY = 'Br5quiybxDxEhw2WsX1EhHMq83f4TZX4RAhoxzkdQG2d';

// ──────────────────────────────────────────────────────────────────────────────
// Args
// ──────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter(a => a !== '--');

const ticker = (args[0] || '').toUpperCase();
const dateStr = args[1] || nyToday();
const fromTime = args[2] || MARKET_OPEN;
const toTime = args[3] || '11:00';
const THRESHOLD = parseFloat(args[4]) || 0.7;
const TP_PCT = parseFloat(args[5]) || 4;
const SL_PCT = parseFloat(args[6]) || 2;

// ──────────────────────────────────────────────────────────────────────────────
// Time helpers
// ──────────────────────────────────────────────────────────────────────────────
function nyToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

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

// ──────────────────────────────────────────────────────────────────────────────
// Numeric helpers
// ──────────────────────────────────────────────────────────────────────────────
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
// Alpaca fetch
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

  const bars = response?.data?.bars?.[symbol] || [];
  return bars;
}

// ──────────────────────────────────────────────────────────────────────────────
// Feature engineering from Alpaca bars
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

    if (isPremarket) {
      preMarketHighSoFar = Math.max(preMarketHighSoFar, row.high);
      premarketVolumeSoFar += row.volume;
    }

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

      future_return_5m: 0,
      target: 0,
      target_break_hod_5m: 0,
      max_future_return_10m: 0,
    });
  }

  for (let i = 0; i < rows.length; i++) {
    const refClose = rows[i].close;
    const future5 = rows.slice(i + 1, i + 6);
    const future10 = rows.slice(i + 1, i + 11);

    const close5 = future5.length ? future5[future5.length - 1].close : refClose;
    const maxHigh10 = future10.length
      ? Math.max(...future10.map(r => r.high))
      : refClose;

    rows[i].future_return_5m = refClose > 0 ? ((close5 - refClose) / refClose) : 0;
    rows[i].max_future_return_10m = refClose > 0 ? ((maxHigh10 - refClose) / refClose) : 0;
    rows[i].target = rows[i].future_return_5m > 0 ? 1 : 0;

    const priorHod = i > 0 ? rows[i - 1].high_of_day : 0;
    rows[i].target_break_hod_5m =
      priorHod > 0 && future5.some(r => r.high > priorHod) ? 1 : 0;
  }

  //save rows to file
  fs.writeFileSync(path.resolve(barsPath), JSON.stringify(rows, null, 2));

  return rows;
}

// ──────────────────────────────────────────────────────────────────────────────
// TP/SL logic
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
// Python predict_batch
// ──────────────────────────────────────────────────────────────────────────────
const stockTraining = path.resolve(__dirname, '..', '..', 'stock-training');
const barsPath = path.resolve(__dirname, '..', '..', 'stock-training', 'data', 'bars.json');
const predictBatchScript = path.join(stockTraining, 'ml', 'experiments', 'predict_batch.py');

function callPredictBatch(batch, threshold) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [predictBatchScript], {
      cwd: path.dirname(predictBatchScript),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', c => {
      stdout += c;
    });

    proc.stderr.on('data', c => {
      stderr += c;
    });

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
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main() {
  if (!ticker) {
    console.error('Usage: node debug-predict-alpaca.js TICKER DATE [fromTime] [toTime] [threshold] [tpPct] [slPct]');
    console.error('Example: node debug-predict-alpaca.js MDAI 2026-03-19 09:30 11:00 0.6 4 2');
    process.exit(1);
  }

  const bars = await fetchBarsFromAlpaca(ticker, dateStr);

  if (!bars.length) {
    console.error(`No Alpaca bars for ${ticker} on ${dateStr}`);
    process.exit(1);
  }

  const rows = buildRowsFromBars(ticker, dateStr, bars);

  if (!rows.length) {
    console.error(`No NY-session rows built for ${ticker} on ${dateStr}`);
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

  console.log(`\n🔮 Debug Predict Alpaca: ${ticker} | ${dateStr} | ${fromTime}–${toTime}`);
  console.log(`   Threshold=${THRESHOLD} | TP=${TP_PCT}% | SL=${SL_PCT}% | Investment=$${INVESTMENT}`);
  console.log('─'.repeat(120));
  console.log(`Fetched ${bars.length} Alpaca bars, built ${rows.length} NY candles, iterating ${targetRows.length} in window\n`);

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
      totalTrades++;

      if (tpSlResult === 'win') totalWins++;
      else if (tpSlResult === 'loss') totalLosses++;
      else totalNeutral++;

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

  const decidedTrades = totalWins + totalLosses;
  const winRate = decidedTrades > 0 ? (totalWins / decidedTrades) * 100 : 0;
  const lossRate = decidedTrades > 0 ? (totalLosses / decidedTrades) * 100 : 0;

  console.log(`Confusion: TP=${tp}  FP=${fp}  TN=${tn}  FN=${fn}`);
  console.log(`Precision: ${(precision * 100).toFixed(1)}%  Recall: ${(recall * 100).toFixed(1)}%  Accuracy: ${(accuracy * 100).toFixed(1)}%`);
  console.log(`Signals (tradeable=true): ${tp + fp} / ${total}`);

  console.log('');
  console.log(`Total trades: ${totalTrades}`);
  console.log(`Total win: ${totalWins}`);
  console.log(`Total loss: ${totalLosses}`);
  console.log(`Total neutral: ${totalNeutral}`);
  console.log(`Win rate: ${winRate.toFixed(2)}%`);
  console.log(`Loss rate: ${lossRate.toFixed(2)}%`);

  console.log(`\n💰 Inversión $${INVESTMENT}/trade → P/L total: ${cumPnL >= 0 ? '+' : ''}$${cumPnL.toFixed(2)}`);
}

main().catch(e => {
  console.error(e?.response?.data || e.message || e);
  process.exit(1);
});