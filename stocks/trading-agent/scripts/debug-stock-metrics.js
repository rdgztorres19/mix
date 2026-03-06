#!/usr/bin/env node
/**
 * Script para verificar cálculos de métricas (EMA, ATR, VWAP, etc.)
 * Obtiene datos de momoscreener y calcula hasta la hora especificada (ET).
 *
 * Uso:
 *   npm run debug-metrics -- GXAI 9:31              # hoy 9:31, velas 5m (default)
 *   npm run debug-metrics -- GXAI 9:31 1m           # velas 1 min
 *   npm run debug-metrics -- GXAI 9:31 5m           # velas 5 min
 *   npm run debug-metrics -- GXAI 2026-03-05 9:31 1m
 *   npm run debug-metrics -- NVDA 5m                # última data, velas 5m
 */

const MOMO_BASE = process.env.MOMO_BASE_URL || 'https://momoscreener.com/api/p';
const PRE_MARKET_HOUR_ET = 4;
const ATR_PERIOD = 14;

// ─── Parse args (ignorar "--" que npm puede pasar) ───────────────────────────
const args = process.argv.slice(2).filter((a) => a !== '--');

// Temporalidad: 1m o 5m (último arg si coincide)
const intervalArg = args[args.length - 1];
const INTERVAL = (intervalArg === '1m' || intervalArg === '5m') ? intervalArg : '5m';
const filteredArgs = (intervalArg === '1m' || intervalArg === '5m') ? args.slice(0, -1) : args;

const ticker = (filteredArgs[0] || 'GXAI').toUpperCase();
let cutoffMs = null;

function parseDate(dateStr) {
  if (!dateStr || !dateStr.includes('-')) return null;
  const parts = dateStr.split('-').map((x) => parseInt(x, 10) || 0);
  const now = new Date();
  if (parts.length >= 3) {
    return { y: parts[0], m: parts[1] || 1, d: parts[2] || 1 };
  }
  if (parts.length === 2) {
    return { y: now.getFullYear(), m: parts[0] || 1, d: parts[1] || 1 };
  }
  return null;
}

function parseTime(timeStr) {
  if (!timeStr || !timeStr.includes(':')) return { hour: 16, minute: 0 };
  const parts = timeStr.split(':').map((x) => parseInt(x, 10) || 0);
  return { hour: parts[0] ?? 9, minute: parts[1] ?? 31 };
}

// filteredArgs[1] puede ser: fecha (2026-03-05, 03-05) O hora (9:31)
// filteredArgs[2] si hay fecha en [1], es la hora
let dateArg = null;
let timeArg = null;
if (filteredArgs[1]) {
  if (filteredArgs[1].includes('-')) {
    dateArg = filteredArgs[1];
    timeArg = filteredArgs[2] || '16:00';
  } else {
    dateArg = null;
    timeArg = filteredArgs[1];
  }
}

if (dateArg || timeArg) {
  const now = new Date();
  const todayET = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // "2026-03-06"
  const [ty, tm, td] = todayET.split('-').map(Number);
  const datePart = dateArg ? parseDate(dateArg) : { y: ty, m: tm, d: td };
  const timePart = parseTime(timeArg || '9:31');
  const targetStr = `${datePart.y}-${String(datePart.m).padStart(2, '0')}-${String(datePart.d).padStart(2, '0')}T${String(timePart.hour).padStart(2, '0')}:${String(timePart.minute).padStart(2, '0')}:00`;
  cutoffMs = new Date(targetStr + '-05:00').getTime();
}

// ─── Fetch 1-min candles ─────────────────────────────────────────────────────
async function fetchCandles(ticker) {
  const url = `${MOMO_BASE}/ticker/chart?q=${ticker}&interval=1m`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await res.json();
  if (data?.error !== 0 || !data?.message?.history) {
    throw new Error(`momoscreener: ${JSON.stringify(data)}`);
  }
  const raw = data.message.history;
  return raw.slice().reverse().map(([o, h, l, c, v, t]) => ({ o, h, l, c, v, t }));
}

// ─── Helpers (misma lógica que scanner.service) ──────────────────────────────
function getHistoryStartMs(candles, days) {
  if (!candles.length) return Date.now() - days * 24 * 60 * 60 * 1000;
  const seen = new Set();
  for (let i = candles.length - 1; i >= 0; i--) {
    const dateKey = new Date(candles[i].t).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    if (!seen.has(dateKey)) seen.add(dateKey);
    if (seen.size >= days) break;
  }
  const targetDateKey = [...seen].at(-1);
  for (let i = 0; i < candles.length; i++) {
    const dateKey = new Date(candles[i].t).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
    if (dateKey === targetDateKey) return candles[i].t;
  }
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function aggregate1mTo5m(candles) {
  const groups = {};
  for (const c of candles) {
    const bucket = Math.floor(c.t / (5 * 60 * 1000)) * (5 * 60 * 1000);
    if (!groups[bucket]) groups[bucket] = [];
    groups[bucket].push(c);
  }
  return Object.keys(groups)
    .map(Number)
    .sort((a, b) => a - b)
    .map((bucket) => {
      const g = groups[bucket];
      return {
        o: g[0].o,
        h: Math.max(...g.map((x) => x.h)),
        l: Math.min(...g.map((x) => x.l)),
        c: g[g.length - 1].c,
        v: g.reduce((s, x) => s + x.v, 0),
        t: bucket,
      };
    });
}

function calcATR(candles, period = 14) {
  if (candles.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    trs.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function calcVWAP(candles) {
  if (!candles.length) return null;
  let totalPV = 0, totalV = 0;
  for (const c of candles) {
    const typical = (c.h + c.l + c.c) / 3;
    totalPV += typical * c.v;
    totalV += c.v;
  }
  return totalV > 0 ? totalPV / totalV : null;
}

function calcEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function estimateAvgDailyVolume(candles) {
  if (candles.length < 10) return 1;
  const dayVolumes = {};
  for (const c of candles) {
    const day = new Date(c.t).toISOString().split('T')[0];
    dayVolumes[day] = (dayVolumes[day] || 0) + c.v;
  }
  const vols = Object.values(dayVolumes);
  return vols.length ? vols.reduce((s, v) => s + v, 0) / vols.length : 1;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📊 Debug Stock Metrics: ${ticker}`);
  console.log(`   Temporalidad: ${INTERVAL} (velas ${INTERVAL === '1m' ? '1 min' : '5 min'})`);
  if (cutoffMs) {
    const et = new Date(cutoffMs).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' });
    console.log(`   Cutoff: ${et} ET`);
  } else {
    console.log('   Cutoff: ninguno (última data disponible)');
  }
  console.log('─'.repeat(50));

  let candles1m = await fetchCandles(ticker);
  if (!candles1m.length) {
    console.error('No candles from momoscreener');
    process.exit(1);
  }

  if (cutoffMs) {
    candles1m = candles1m.filter((c) => c.t <= cutoffMs);
    if (!candles1m.length) {
      console.error('No candles after cutoff');
      process.exit(1);
    }
  }

  const historyStart = getHistoryStartMs(candles1m, 1);
  const marketOpenOffset = (9.5 - PRE_MARKET_HOUR_ET) * 60 * 60 * 1000;
  const lastDayStart = getHistoryStartMs(candles1m, 1);
  const marketOpen = lastDayStart + marketOpenOffset;

  const candles1mDay = candles1m.filter((c) => c.t >= historyStart);
  const candles5mDay = aggregate1mTo5m(candles1mDay);

  const candlesForMetrics = INTERVAL === '1m' ? candles1mDay : candles5mDay;
  const latest = candlesForMetrics[candlesForMetrics.length - 1];
  const price = latest.c;

  const sessionCandles = candles1mDay.filter((c) => c.t >= marketOpen);
  const preMarketCandles = candles1mDay.filter((c) => c.t < marketOpen);

  const high_of_day = candles1mDay.length ? Math.max(...candles1mDay.map((c) => c.h)) : price;
  const low_of_day = candles1mDay.length ? Math.min(...candles1mDay.map((c) => c.l)) : price;
  const pre_market_high = preMarketCandles.length ? Math.max(...preMarketCandles.map((c) => c.h)) : null;

  const priorDayCandles = candles1m.filter((c) => c.t < lastDayStart);
  const prior_close = priorDayCandles.length ? priorDayCandles[priorDayCandles.length - 1].c : price;
  const change_pct = prior_close > 0 ? (price - prior_close) / prior_close : 0;

  const avg_volume = estimateAvgDailyVolume(candles1m);
  const volume = sessionCandles.reduce((s, c) => s + c.v, 0);
  const rel_vol = avg_volume > 0 ? volume / avg_volume : 0;

  const vwap = calcVWAP(candlesForMetrics);
  const closes = candlesForMetrics.map((c) => c.c);
  const ema9 = calcEMA(closes, 9);
  const ema20 = calcEMA(closes, 20);
  const atr = calcATR(candlesForMetrics, ATR_PERIOD);

  const firstCandle = candlesForMetrics[0];
  const lastCandle = candlesForMetrics[candlesForMetrics.length - 1];
  const rangeStart = firstCandle ? new Date(firstCandle.t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : 'N/A';
  const rangeEnd = lastCandle ? new Date(lastCandle.t).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : 'N/A';

  console.log(`
─── Temporalidad ─────────────────────────────────────
Fecha (ET):      ${firstCandle ? new Date(firstCandle.t).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}
Rango de datos:  ${rangeStart} → ${rangeEnd} ET
Métricas (VWAP, EMA9, EMA20, ATR, Price): velas ${INTERVAL}
───────────────────────────────────────────────────────

Price:           $${price.toFixed(2)}
Change Today:    ${(change_pct * 100).toFixed(2)}%

High of Day:     $${high_of_day.toFixed(2)}
Low of Day:      $${low_of_day.toFixed(2)}
Pre-market High: ${pre_market_high != null ? '$' + pre_market_high.toFixed(2) : 'N/A'}

VWAP:            ${vwap != null ? '$' + vwap.toFixed(2) : 'N/A'}
EMA9:            ${ema9 != null ? '$' + ema9.toFixed(2) : 'N/A'}
EMA20:           ${ema20 != null ? '$' + ema20.toFixed(2) : 'N/A'}
ATR (14):        $${atr.toFixed(2)}

Volume:          ${(volume / 1e6).toFixed(2)}M
Avg Volume:      ${(avg_volume / 1e6).toFixed(2)}M
Relative Vol:    ${rel_vol.toFixed(2)}x

Candles ${INTERVAL} usadas: ${candlesForMetrics.length}
`);

  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
