#!/usr/bin/env tsx
/**
 * Añade features para momentum intradía.
 * Features recomendadas: ~30-45 para modelos de small-cap trading.
 *
 * MANTENER: volume_rel, dist_vwap_pct, atr_rel, minute_of_day, rsi, volatility_15m,
 *   mom_5, mom_10, return_lag_1/2/3
 * NUEVAS: dist_hod_pct, dist_pm_high, break_hod, break_pm_high, range_expansion,
 *   float_rotation, dollar_volume, relative_dollar_volume, volume_spike, vwap_cross_up,
 *   dist_ema9, dist_ema20, momentum_acceleration, dist_lod_pct, is_open, is_midday,
 *   is_power_hour, dist_gap, relative_range
 *
 * Uso: npm run add-features -- [--input data/training-multiclass.csv] [--output data/training-enriched.csv]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { CSV_COLUMNS } from '../src/csv/csv-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NEW_FEATURES = [
  'volume_rel',
  'dist_vwap_pct',
  'atr_rel',
  'minute_of_day',
  'rsi',
  'volatility_15m',
  'mom_5',
  'mom_10',
  'return_lag_1',
  'return_lag_2',
  'return_lag_3',
  'dist_hod_pct',
  'dist_lod_pct',
  'dist_pm_high',
  'break_hod',
  'break_pm_high',
  'range_expansion',
  'float_rotation',
  'dollar_volume',
  'relative_dollar_volume',
  'volume_spike',
  'vwap_cross_up',
  'dist_ema9',
  'dist_ema20',
  'momentum_acceleration',
  'is_open',
  'is_midday',
  'is_power_hour',
  'dist_gap',
  'relative_range',
] as const;

// Columnas del CSV original (31) tal como las genera build-training-csv
const INPUT_COLUMNS = [
  'symbol',
  'date',
  'candle_time_et',
  'candle_idx',
  'open',
  'high',
  'low',
  'close',
  'volume',
  'atr',
  'vwap',
  'high_of_day',
  'low_of_day',
  'change_pct_at_candle',
  'ema9',
  'ema20',
  'pre_market_high',
  'session',
  'shares_outstanding',
  'market_cap',
  'gap_pct',
  'premarket_volume',
  'momentum_acumulado',
  'change_1m',
  'change_5m',
  'change_10m',
  'minutes_since_hod',
  'future_return_5m',
  'target',
  'target_break_hod_5m',
  'max_future_return_10m',
] as const;

const IDX_SYMBOL = INPUT_COLUMNS.indexOf('symbol');
const IDX_DATE = INPUT_COLUMNS.indexOf('date');
const IDX_CANDLE_IDX = INPUT_COLUMNS.indexOf('candle_idx');
const IDX_OPEN = INPUT_COLUMNS.indexOf('open');
const IDX_HIGH = INPUT_COLUMNS.indexOf('high');
const IDX_LOW = INPUT_COLUMNS.indexOf('low');
const IDX_VOLUME = INPUT_COLUMNS.indexOf('volume');
const IDX_CLOSE = INPUT_COLUMNS.indexOf('close');
const IDX_ATR = INPUT_COLUMNS.indexOf('atr');
const IDX_VWAP = INPUT_COLUMNS.indexOf('vwap');
const IDX_HIGH_OF_DAY = INPUT_COLUMNS.indexOf('high_of_day');
const IDX_LOW_OF_DAY = INPUT_COLUMNS.indexOf('low_of_day');
const IDX_EMA9 = INPUT_COLUMNS.indexOf('ema9');
const IDX_EMA20 = INPUT_COLUMNS.indexOf('ema20');
const IDX_PRE_MARKET_HIGH = INPUT_COLUMNS.indexOf('pre_market_high');
const IDX_PREMARKET_VOLUME = INPUT_COLUMNS.indexOf('premarket_volume');
const IDX_SHARES_OUTSTANDING = INPUT_COLUMNS.indexOf('shares_outstanding');
const IDX_CANDLE_TIME_ET = INPUT_COLUMNS.indexOf('candle_time_et');

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

const MARKET_OPEN_MIN = 9 * 60 + 30; // 9:30 AM ET

function parseMinuteOfDay(candleTimeEt: string): number {
  const m = candleTimeEt.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  const minuteFromMidnight = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return Math.max(0, minuteFromMidnight - MARKET_OPEN_MIN);
}

/** EMA: k = 2/(n+1), EMA_t = price_t * k + EMA_{t-1} * (1-k) */
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

/** RSI 14 (Wilder smoothing) */
function computeRSI(closes: number[], period = 14): number[] {
  const out: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      out.push(50); // neutral hasta tener suficientes datos
      continue;
    }
    let avgGain = 0;
    let avgLoss = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const ch = (closes[j] ?? 0) - (closes[j - 1] ?? closes[j]);
      if (ch > 0) avgGain += ch;
      else avgLoss -= ch;
    }
    avgGain /= period;
    avgLoss /= period;
    if (avgLoss === 0) {
      out.push(100);
      continue;
    }
    const rs = avgGain / avgLoss;
    out.push(100 - 100 / (1 + rs));
  }
  return out;
}

interface IndicatorRow {
  rsi: number;
  returnLag1: number;
  returnLag2: number;
  returnLag3: number;
  volatility15m: number;
  mom5: number;
  mom10: number;
  cumulativeVolume: number;
  avgVolume20: number;
  avgDollarVolume20: number;
  highOfDayPrev: number;
  vwapCrossUp: number;
}

function computeIndicatorsForGroup(rows: string[][]): IndicatorRow[] {
  const closes = rows.map((r) => parseFloat(r[IDX_CLOSE] ?? '0') || 0);
  const volumes = rows.map((r) => parseFloat(r[IDX_VOLUME] ?? '0') || 0);
  const vwaps = rows.map((r) => parseFloat(r[IDX_VWAP] ?? '0') || 0);
  const highOfDays = rows.map((r) => parseFloat(r[IDX_HIGH_OF_DAY] ?? '0') || 0);

  const rsiArr = computeRSI(closes);

  const cumVol: number[] = [];
  let cv = 0;
  for (const v of volumes) {
    cv += v;
    cumVol.push(cv);
  }

  const W = 20;
  const avgVol20: number[] = [];
  const dollarVolumes = volumes.map((v, i) => (closes[i] ?? 0) * v);
  const avgDv20: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const start = Math.max(0, i - W + 1);
    const volSlice = volumes.slice(start, i + 1);
    const dvSlice = dollarVolumes.slice(start, i + 1);
    avgVol20.push(volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 1);
    avgDv20.push(dvSlice.length > 0 ? dvSlice.reduce((a, b) => a + b, 0) / dvSlice.length : 1);
  }

  const result: IndicatorRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const returnLag1 = i >= 2 && (closes[i - 2] ?? 0) > 0
      ? ((closes[i - 1] ?? 0) - (closes[i - 2] ?? 0)) / (closes[i - 2] ?? 1) : 0;
    const returnLag2 = i >= 3 && (closes[i - 3] ?? 0) > 0
      ? ((closes[i - 2] ?? 0) - (closes[i - 3] ?? 0)) / (closes[i - 3] ?? 1) : 0;
    const returnLag3 = i >= 4 && (closes[i - 4] ?? 0) > 0
      ? ((closes[i - 3] ?? 0) - (closes[i - 4] ?? 0)) / (closes[i - 4] ?? 1) : 0;

    let volatility15m = 0;
    if (i >= 14) {
      const returns: number[] = [];
      for (let j = i - 14; j <= i; j++) {
        if (j >= 1 && (closes[j - 1] ?? 0) > 0) {
          returns.push(((closes[j] ?? 0) - (closes[j - 1] ?? 0)) / (closes[j - 1] ?? 1));
        }
      }
      if (returns.length > 1) {
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
        volatility15m = Math.sqrt(variance) || 0;
      }
    }

    const mom5 = i >= 5 && (closes[i - 5] ?? 0) > 0
      ? ((closes[i] ?? 0) - (closes[i - 5] ?? 0)) / (closes[i - 5] ?? 1)
      : 0;
    const mom10 = i >= 10 && (closes[i - 10] ?? 0) > 0
      ? ((closes[i] ?? 0) - (closes[i - 10] ?? 0)) / (closes[i - 10] ?? 1)
      : 0;

    const highOfDayPrev = i > 0 ? (highOfDays[i - 1] ?? 0) : 0;
    const vwapCrossUp = i >= 1 && (vwaps[i] ?? 0) > 0 && (vwaps[i - 1] ?? 0) > 0
      ? ((closes[i] ?? 0) > (vwaps[i] ?? 0) && (closes[i - 1] ?? 0) <= (vwaps[i - 1] ?? 0)) ? 1 : 0
      : 0;

    result.push({
      rsi: rsiArr[i] ?? 50,
      returnLag1,
      returnLag2,
      returnLag3,
      volatility15m,
      mom5,
      mom10,
      cumulativeVolume: cumVol[i] ?? 0,
      avgVolume20: avgVol20[i] ?? 1,
      avgDollarVolume20: avgDv20[i] ?? 1,
      highOfDayPrev,
      vwapCrossUp,
    });
  }
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const dataDir = path.join(__dirname, '../data');
  let inputPath = path.join(dataDir, 'training-multiclass.csv');
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
    const fallback1 = path.join(dataDir, 'training-2p5.csv');
    const fallback2 = path.join(dataDir, 'training.csv');
    if (fs.existsSync(fallback1)) {
      inputPath = fallback1;
      console.log('Usando', inputPath, '(training-multiclass.csv no encontrado)');
    } else if (fs.existsSync(fallback2)) {
      inputPath = fallback2;
      console.log('Usando', inputPath, '(training-multiclass.csv no encontrado)');
    } else {
      console.error('No existe:', inputPath, 'ni', fallback1, 'ni', fallback2);
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
  const dataStart = hasHeader ? 1 : 0;
  const firstDataRow = dataStart < lines.length ? parseCsvLine(lines[dataStart]) : firstLine;
  const colCount = firstDataRow.length;
  const headers: string[] =
    hasHeader
      ? firstLine
      : colCount >= 50
        ? [...CSV_COLUMNS]
        : [...INPUT_COLUMNS];

  const idxFutureReturn = headers.indexOf('future_return_5m');
  const is56Col = colCount >= 50;
  const baseColsEnd = 27;
  const tailColsStart = is56Col
    ? (colCount === 56 ? 52 : idxFutureReturn >= 0 ? idxFutureReturn : 53)
    : 27;

  const rows: string[][] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (vals.length !== colCount) continue;
    rows.push(vals);
  }

  // Agrupar por symbol+date y ordenar por candle_idx
  const groupMap = new Map<string, string[][]>();
  for (const vals of rows) {
    const key = `${vals[IDX_SYMBOL]}|${vals[IDX_DATE]}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(vals);
  }
  for (const arr of groupMap.values()) {
    arr.sort((a, b) => {
      const ia = parseInt(a[IDX_CANDLE_IDX] ?? '0', 10) || 0;
      const ib = parseInt(b[IDX_CANDLE_IDX] ?? '0', 10) || 0;
      return ia - ib;
    });
  }

  const defaultInd: IndicatorRow = {
    rsi: 50,
    returnLag1: 0,
    returnLag2: 0,
    returnLag3: 0,
    volatility15m: 0,
    mom5: 0,
    mom10: 0,
    cumulativeVolume: 0,
    avgVolume20: 1,
    avgDollarVolume20: 1,
    highOfDayPrev: 0,
    vwapCrossUp: 0,
  };

  // Precalcular indicadores por grupo. Mapeamos (key, candle_idx) -> indicadores
  const indicatorsByKeyCandle = new Map<string, Map<number, IndicatorRow>>();
  for (const [key, groupRows] of groupMap) {
    const inds = computeIndicatorsForGroup(groupRows);
    const m = new Map<number, IndicatorRow>();
    for (let i = 0; i < groupRows.length; i++) {
      const cidx = parseInt(groupRows[i][IDX_CANDLE_IDX] ?? '0', 10) || 0;
      m.set(cidx, inds[i] ?? defaultInd);
    }
    indicatorsByKeyCandle.set(key, m);
  }

  // Promedios de volumen por symbol+date
  const volSum = new Map<string, number>();
  const volCount = new Map<string, number>();
  for (const vals of rows) {
    const key = `${vals[IDX_SYMBOL]}|${vals[IDX_DATE]}`;
    const v = parseFloat(vals[IDX_VOLUME] ?? '0') || 0;
    volSum.set(key, (volSum.get(key) ?? 0) + v);
    volCount.set(key, (volCount.get(key) ?? 0) + 1);
  }
  const avgVolumeByKey = new Map<string, number>();
  for (const k of volSum.keys()) {
    const sum = volSum.get(k) ?? 0;
    const n = volCount.get(k) ?? 1;
    avgVolumeByKey.set(k, n > 0 ? sum / n : 1);
  }

  // Header para que train/evaluate carguen por nombre (31 o 56 cols)
  const outHeader = [
    ...INPUT_COLUMNS.slice(0, 27),
    ...NEW_FEATURES,
    ...INPUT_COLUMNS.slice(27),
  ].map((c) => escapeCsv(c)).join(',');

  const out: string[] = [outHeader];
  const idxChange1m = headers.indexOf('change_1m');
  const idxChange5m = headers.indexOf('change_5m');
  for (const vals of rows) {
    const open = parseFloat(vals[IDX_OPEN] ?? '0') || 0;
    const high = parseFloat(vals[IDX_HIGH] ?? '0') || 0;
    const low = parseFloat(vals[IDX_LOW] ?? '0') || 0;
    const volume = parseFloat(vals[IDX_VOLUME] ?? '0') || 0;
    const close = parseFloat(vals[IDX_CLOSE] ?? '0') || 0;
    const atr = parseFloat(vals[IDX_ATR] ?? '0') || 0;
    const vwap = parseFloat(vals[IDX_VWAP] ?? '0') || 0;
    const highOfDay = parseFloat(vals[IDX_HIGH_OF_DAY] ?? '0') || 0;
    const lowOfDay = parseFloat(vals[IDX_LOW_OF_DAY] ?? '0') || 0;
    const ema9 = parseFloat(vals[IDX_EMA9] ?? '0') || 0;
    const ema20 = parseFloat(vals[IDX_EMA20] ?? '0') || 0;
    const preMarketHigh = parseFloat(vals[IDX_PRE_MARKET_HIGH] ?? '0') || 0;
    const sharesOutstanding = parseFloat(vals[IDX_SHARES_OUTSTANDING] ?? '0') || 0;
    const change1m = parseFloat(vals[idxChange1m >= 0 ? idxChange1m : 0] ?? '0') || 0;
    const change5m = parseFloat(vals[idxChange5m >= 0 ? idxChange5m : 0] ?? '0') || 0;

    const candleTime = vals[IDX_CANDLE_TIME_ET] ?? '';
    const candleIdx = parseInt(vals[IDX_CANDLE_IDX] ?? '0', 10) || 0;
    const key = `${vals[IDX_SYMBOL]}|${vals[IDX_DATE]}`;
    const ind = indicatorsByKeyCandle.get(key)?.get(candleIdx) ?? defaultInd;

    const avgVol = avgVolumeByKey.get(key) ?? 1;
    const volumeRel = avgVol > 0 ? volume / avgVol : 1;
    const distVwapPct = vwap > 0 ? (close - vwap) / vwap : 0;
    const atrRel = atr > 0 ? (high - low) / atr : 0;
    const minuteOfDay = parseMinuteOfDay(candleTime);

    const distHodPct = highOfDay > 0 ? (highOfDay - close) / highOfDay : 0;
    const distLodPct = lowOfDay > 0 ? (close - lowOfDay) / lowOfDay : 0;
    const distPmHigh = preMarketHigh > 0 ? (preMarketHigh - close) / preMarketHigh : 0;
    const breakHod = close > ind.highOfDayPrev ? 1 : 0;
    const breakPmHigh = preMarketHigh > 0 && close > preMarketHigh ? 1 : 0;
    const rangeExpansion = atr > 0 ? (high - low) / atr : 0;
    const floatRotation = sharesOutstanding > 0 ? ind.cumulativeVolume / sharesOutstanding : 0;
    const dollarVolume = close * volume;
    const relativeDollarVolume = ind.avgDollarVolume20 > 0 ? dollarVolume / ind.avgDollarVolume20 : 1;
    const volumeSpike = ind.avgVolume20 > 0 ? volume / ind.avgVolume20 : 1;
    const distEma9 = ema9 > 0 ? (close - ema9) / ema9 : 0;
    const distEma20 = ema20 > 0 ? (close - ema20) / ema20 : 0;
    const momentumAcceleration = change1m - change5m;
    const isOpen = minuteOfDay < 60 ? 1 : 0;
    const isMidday = minuteOfDay > 120 && minuteOfDay < 240 ? 1 : 0;
    const isPowerHour = minuteOfDay > 330 ? 1 : 0;
    const distGap = open > 0 ? (close - open) / open : 0;
    const relativeRange = close > 0 ? (high - low) / close : 0;

    const newVals = [
      ...vals.slice(0, baseColsEnd),
      volumeRel.toFixed(6),
      distVwapPct.toFixed(6),
      atrRel.toFixed(6),
      String(minuteOfDay),
      ind.rsi.toFixed(4),
      ind.volatility15m.toFixed(6),
      ind.mom5.toFixed(6),
      ind.mom10.toFixed(6),
      ind.returnLag1.toFixed(6),
      ind.returnLag2.toFixed(6),
      ind.returnLag3.toFixed(6),
      distHodPct.toFixed(6),
      distLodPct.toFixed(6),
      distPmHigh.toFixed(6),
      String(breakHod),
      String(breakPmHigh),
      rangeExpansion.toFixed(6),
      floatRotation.toFixed(6),
      dollarVolume.toFixed(2),
      relativeDollarVolume.toFixed(6),
      volumeSpike.toFixed(6),
      String(ind.vwapCrossUp),
      distEma9.toFixed(6),
      distEma20.toFixed(6),
      momentumAcceleration.toFixed(6),
      String(isOpen),
      String(isMidday),
      String(isPowerHour),
      distGap.toFixed(6),
      relativeRange.toFixed(6),
      ...vals.slice(tailColsStart),
    ];
    out.push(newVals.map((v) => escapeCsv(v)).join(','));
  }

  fs.writeFileSync(outputPath, out.join('\n') + '\n', 'utf-8');
  console.log('Features añadidas:', NEW_FEATURES.join(', '));
  console.log('Filas:', rows.length);
  console.log('Guardado:', outputPath);
}

main();
