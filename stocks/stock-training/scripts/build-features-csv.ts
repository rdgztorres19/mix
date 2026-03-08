#!/usr/bin/env tsx
/**
 * Construye training-enriched.csv con features recomendadas por documentación académica.
 * Lee training.csv (o output de recompute-target), computa features por symbol+date.
 *
 * Features: volume_rel, dist_vwap_pct, atr_rel, volume_pm_ratio, minute_of_day, fraction_of_day,
 *   macd, macd_signal, macd_hist, rsi, bb_position, stoch_k, stoch_d, cci_20,
 *   return_lag_1..20, volatility_15m, mom_5, mom_10, return_1m_lag1, return_1m_lag2
 *
 * Uso: npm run build-features -- [--input data/training-2p5.csv] [--output data/training-enriched.csv]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LAG_PERIODS = [1, 2, 3, 5, 10, 20] as const;
const MOM_PERIODS = [5, 10] as const;

const NEW_FEATURES = [
  'volume_rel',
  'dist_vwap_pct',
  'atr_rel',
  'volume_pm_ratio',
  'minute_of_day',
  'fraction_of_day',
  'macd',
  'macd_signal',
  'macd_hist',
  'rsi',
  'bb_position',
  'stoch_k',
  'stoch_d',
  'cci_20',
  ...LAG_PERIODS.map((m) => `return_lag_${m}` as const),
  'volatility_15m',
  ...MOM_PERIODS.map((n) => `mom_${n}` as const),
  'return_1m_lag1',
  'return_1m_lag2',
] as const;

const INPUT_COLUMNS = [
  'symbol', 'date', 'candle_time_et', 'candle_idx', 'open', 'high', 'low', 'close', 'volume',
  'atr', 'vwap', 'high_of_day', 'low_of_day', 'change_pct_at_candle', 'ema9', 'ema20',
  'pre_market_high', 'session',
  'shares_outstanding', 'market_cap', 'gap_pct', 'premarket_volume',
  'momentum_acumulado', 'change_1m', 'change_5m', 'change_10m', 'minutes_since_hod',
  'future_return_5m', 'target', 'target_break_hod_5m', 'max_future_return_10m',
] as const;

const IDX_SYMBOL = INPUT_COLUMNS.indexOf('symbol');
const IDX_DATE = INPUT_COLUMNS.indexOf('date');
const IDX_CANDLE_IDX = INPUT_COLUMNS.indexOf('candle_idx');
const IDX_VOLUME = INPUT_COLUMNS.indexOf('volume');
const IDX_CLOSE = INPUT_COLUMNS.indexOf('close');
const IDX_ATR = INPUT_COLUMNS.indexOf('atr');
const IDX_VWAP = INPUT_COLUMNS.indexOf('vwap');
const IDX_PREMARKET_VOLUME = INPUT_COLUMNS.indexOf('premarket_volume');
const IDX_CANDLE_TIME_ET = INPUT_COLUMNS.indexOf('candle_time_et');
const IDX_CHANGE_1M = INPUT_COLUMNS.indexOf('change_1m');

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
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

function escapeCsv(val: string | number): string {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseMinuteOfDay(candleTimeEt: string): number {
  const m = candleTimeEt.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** 9:30 AM ET = 570 min from midnight; trading day ~510 min (9:30-18:00) */
function fractionOfDay(minuteOfDay: number): number {
  const OPEN_MIN = 9 * 60 + 30;
  const TRADING_MIN = 510;
  const sinceOpen = minuteOfDay - OPEN_MIN;
  if (sinceOpen <= 0) return 0;
  return Math.min(1, sinceOpen / TRADING_MIN);
}

function ema(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = prices[0] ?? 0;
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i] ?? prev;
    prev = i === 0 ? p : p * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function computeMACD(closes: number[]): { macd: number[]; signal: number[]; hist: number[] } {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => (ema12[i] ?? 0) - (ema26[i] ?? 0));
  const signalLine = ema(macdLine, 9);
  const hist = macdLine.map((m, i) => m - (signalLine[i] ?? 0));
  return { macd: macdLine, signal: signalLine, hist };
}

function computeRSI(closes: number[], period = 14): number[] {
  const out: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      out.push(50);
      continue;
    }
    let avgGain = 0, avgLoss = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const ch = (closes[j] ?? 0) - (closes[j - 1] ?? closes[j]);
      if (ch > 0) avgGain += ch;
      else avgLoss -= ch;
    }
    avgGain /= period;
    avgLoss /= period;
    out.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return out;
}

function computeBBPosition(closes: number[], period = 20, mult = 2): number[] {
  const out: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(0.5);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance) || 1e-10;
    const upper = mean + mult * std;
    const lower = mean - mult * std;
    const c = closes[i] ?? mean;
    const width = upper - lower;
    out.push(Math.max(0, Math.min(1, width > 0 ? (c - lower) / width : 0.5)));
  }
  return out;
}

/** Stochastic %K (14), %D = SMA(%K, 3) */
function computeStochastic(highs: number[], lows: number[], closes: number[], kPeriod = 14, dPeriod = 3): { k: number[]; d: number[] } {
  const kArr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) {
      kArr.push(50);
      continue;
    }
    const h = highs.slice(i - kPeriod + 1, i + 1);
    const l = lows.slice(i - kPeriod + 1, i + 1);
    const highN = Math.max(...h);
    const lowN = Math.min(...l);
    const range = highN - lowN;
    const c = closes[i] ?? 0;
    kArr.push(range > 0 ? ((c - lowN) / range) * 100 : 50);
  }
  const dArr: number[] = [];
  for (let i = 0; i < kArr.length; i++) {
    if (i < dPeriod - 1) {
      dArr.push(kArr[i] ?? 50);
      continue;
    }
    const slice = kArr.slice(i - dPeriod + 1, i + 1);
    dArr.push(slice.reduce((a, b) => a + b, 0) / dPeriod);
  }
  return { k: kArr, d: dArr };
}

/** CCI-20: (TP - SMA(TP,20)) / (0.015 * MD) */
function computeCCI(highs: number[], lows: number[], closes: number[], period = 20): number[] {
  const tp = closes.map((c, i) => ((highs[i] ?? c) + (lows[i] ?? c) + c) / 3);
  const out: number[] = [];
  for (let i = 0; i < tp.length; i++) {
    if (i < period - 1) {
      out.push(0);
      continue;
    }
    const slice = tp.slice(i - period + 1, i + 1);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const md = slice.reduce((a, b) => a + Math.abs(b - sma), 0) / period;
    const cci = md > 0 ? (tp[i]! - sma) / (0.015 * md) : 0;
    out.push(cci);
  }
  return out;
}

interface EnrichedRow {
  volumeRel: number;
  distVwapPct: number;
  atrRel: number;
  volumePmRatio: number;
  minuteOfDay: number;
  fractionOfDay: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  rsi: number;
  bbPosition: number;
  stochK: number;
  stochD: number;
  cci20: number;
  returnLag: Record<number, number>;
  volatility15m: number;
  mom: Record<number, number>;
  return1mLag1: number;
  return1mLag2: number;
}

function computeEnrichedForGroup(rows: string[][]): Map<number, EnrichedRow> {
  const closes = rows.map((r) => parseFloat(r[IDX_CLOSE] ?? '0') || 0);
  const highs = rows.map((r) => parseFloat(r[6] ?? '0') || 0); // high
  const lows = rows.map((r) => parseFloat(r[7] ?? '0') || 0);  // low
  const volumes = rows.map((r) => parseFloat(r[IDX_VOLUME] ?? '0') || 0);
  const atrs = rows.map((r) => parseFloat(r[IDX_ATR] ?? '0') || 0);
  const vwaps = rows.map((r) => parseFloat(r[IDX_VWAP] ?? '0') || 0);
  const change1ms = rows.map((r) => parseFloat(r[IDX_CHANGE_1M] ?? '') || 0);

  const avgVol = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);
  const { macd, signal, hist } = computeMACD(closes);
  const rsiArr = computeRSI(closes);
  const bbArr = computeBBPosition(closes);
  const { k: stochK, d: stochD } = computeStochastic(highs, lows, closes);
  const cciArr = computeCCI(highs, lows, closes);

  const returns: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const prev = i >= 1 ? closes[i - 1] : closes[i];
    returns.push(prev > 0 ? (closes[i]! - prev) / prev : 0);
  }

  const result = new Map<number, EnrichedRow>();
  for (let i = 0; i < rows.length; i++) {
    const cidx = parseInt(rows[i][IDX_CANDLE_IDX] ?? '0', 10) || 0;
    const close = closes[i] ?? 0;
    const vwap = vwaps[i] ?? 0;
    const atr = atrs[i] ?? 0;
    const pmVol = parseFloat(rows[i][INPUT_COLUMNS.indexOf('premarket_volume')] ?? '0') || 0;
    const candleTime = rows[i][IDX_CANDLE_TIME_ET] ?? '';
    const minuteOfDay = parseMinuteOfDay(candleTime);

    const returnLag: Record<number, number> = {};
    for (const m of LAG_PERIODS) {
      const pPrev = i >= m && closes[i - m]! > 0 ? closes[i - m]! : close;
      returnLag[m] = pPrev > 0 ? close / pPrev - 1 : 0;
    }

    let volatility15m = 0;
    if (i >= 14) {
      const retSlice = returns.slice(i - 14, i + 1);
      const mean = retSlice.reduce((a, b) => a + b, 0) / retSlice.length;
      const variance = retSlice.reduce((a, b) => a + (b - mean) ** 2, 0) / retSlice.length;
      volatility15m = Math.sqrt(variance) || 0;
    }

    const mom: Record<number, number> = {};
    for (const n of MOM_PERIODS) {
      const pPrev = i >= n && closes[i - n]! > 0 ? closes[i - n]! : close;
      mom[n] = pPrev > 0 ? (close / pPrev) * 100 : 100;
    }

    const return1mLag1 = i >= 1 ? change1ms[i - 1]! : 0;
    const return1mLag2 = i >= 2 ? change1ms[i - 2]! : 0;

    result.set(cidx, {
      volumeRel: avgVol > 0 ? volumes[i]! / avgVol : 1,
      distVwapPct: vwap > 0 ? ((close - vwap) / vwap) * 100 : 0,
      atrRel: close > 0 ? (atr / close) * 100 : 0,
      volumePmRatio: pmVol > 0 ? volumes[i]! / pmVol : 0,
      minuteOfDay,
      fractionOfDay: fractionOfDay(minuteOfDay),
      macd: macd[i] ?? 0,
      macdSignal: signal[i] ?? 0,
      macdHist: hist[i] ?? 0,
      rsi: rsiArr[i] ?? 50,
      bbPosition: bbArr[i] ?? 0.5,
      stochK: stochK[i] ?? 50,
      stochD: stochD[i] ?? 50,
      cci20: cciArr[i] ?? 0,
      returnLag,
      volatility15m,
      mom,
      return1mLag1,
      return1mLag2,
    });
  }
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const dataDir = path.join(__dirname, '../data');
  let inputPath = path.join(dataDir, 'training-2p5.csv');
  let outputPath = path.join(dataDir, 'training-enriched.csv');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputPath = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = path.resolve(args[i + 1]);
      i++;
    }
  }

  if (!fs.existsSync(inputPath)) {
    const fallback = path.join(dataDir, 'training.csv');
    if (fs.existsSync(fallback)) {
      inputPath = fallback;
      console.log('Usando', inputPath);
    } else {
      console.error('No existe:', inputPath);
      process.exit(1);
    }
  }

  const content = fs.readFileSync(inputPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) {
    console.error('CSV vacío');
    process.exit(1);
  }

  const firstLine = parseCsvLine(lines[0]);
  const hasHeader = firstLine.some((v) => String(v).toLowerCase() === 'symbol');
  const headers = hasHeader ? firstLine : [...INPUT_COLUMNS];
  const dataStart = hasHeader ? 1 : 0;

  const insertIdx = headers.findIndex((h) => String(h).toLowerCase() === 'future_return_5m');
  const safeInsertIdx = insertIdx >= 0 ? insertIdx : headers.length;

  const rows: string[][] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (vals.length < safeInsertIdx + 4) continue;
    rows.push(vals);
  }

  const groupMap = new Map<string, string[][]>();
  for (const vals of rows) {
    const key = `${vals[IDX_SYMBOL]}|${vals[IDX_DATE]}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(vals);
  }
  for (const arr of groupMap.values()) {
    arr.sort((a, b) => (parseInt(a[IDX_CANDLE_IDX] ?? '0', 10) || 0) - (parseInt(b[IDX_CANDLE_IDX] ?? '0', 10) || 0));
  }

  const enrichedByKey = new Map<string, Map<number, EnrichedRow>>();
  for (const [key, groupRows] of groupMap) {
    enrichedByKey.set(key, computeEnrichedForGroup(groupRows));
  }

  const outHeader = [
    ...headers.slice(0, safeInsertIdx),
    ...NEW_FEATURES,
    ...headers.slice(safeInsertIdx),
  ].map(escapeCsv).join(',');

  const out: string[] = [outHeader];
  for (const vals of rows) {
    const key = `${vals[IDX_SYMBOL]}|${vals[IDX_DATE]}`;
    const candleIdx = parseInt(vals[IDX_CANDLE_IDX] ?? '0', 10) || 0;
    const e = enrichedByKey.get(key)?.get(candleIdx) ?? {
      volumeRel: 1, distVwapPct: 0, atrRel: 0, volumePmRatio: 0, minuteOfDay: 0, fractionOfDay: 0.5,
      macd: 0, macdSignal: 0, macdHist: 0, rsi: 50, bbPosition: 0.5, stochK: 50, stochD: 50, cci20: 0,
      returnLag: Object.fromEntries(LAG_PERIODS.map((m) => [m, 0])),
      volatility15m: 0, mom: Object.fromEntries(MOM_PERIODS.map((n) => [n, 100])),
      return1mLag1: 0, return1mLag2: 0,
    };

    const newFeatureVals = [
      e.volumeRel.toFixed(6),
      e.distVwapPct.toFixed(6),
      e.atrRel.toFixed(6),
      e.volumePmRatio.toFixed(6),
      String(e.minuteOfDay),
      e.fractionOfDay.toFixed(6),
      e.macd.toFixed(6),
      e.macdSignal.toFixed(6),
      e.macdHist.toFixed(6),
      e.rsi.toFixed(4),
      e.bbPosition.toFixed(6),
      e.stochK.toFixed(4),
      e.stochD.toFixed(4),
      e.cci20.toFixed(4),
      ...LAG_PERIODS.map((m) => (e.returnLag[m] ?? 0).toFixed(6)),
      e.volatility15m.toFixed(6),
      ...MOM_PERIODS.map((n) => (e.mom[n] ?? 100).toFixed(4)),
      e.return1mLag1.toFixed(6),
      e.return1mLag2.toFixed(6),
    ];

    const newVals = [...vals.slice(0, safeInsertIdx), ...newFeatureVals, ...vals.slice(safeInsertIdx)];
    out.push(newVals.map((v) => escapeCsv(v)).join(','));
  }

  fs.writeFileSync(outputPath, out.join('\n') + '\n', 'utf-8');
  console.log('Features:', NEW_FEATURES.length);
  console.log('Filas:', rows.length);
  console.log('Guardado:', outputPath);
}

main();
