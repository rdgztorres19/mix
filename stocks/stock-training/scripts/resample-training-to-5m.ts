#!/usr/bin/env tsx
/**
 * Resample 1-min training CSV to 5-min.
 * Reads training.csv, aggregates candles to 5-min, recalculates indicators.
 * No API calls — pure file transformation.
 *
 * Usage: npm run build-csv-5m [-- --input data/training.csv] [--output data/training-5m.csv]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { calculateAtr } from '../src/indicators/atr';
import { calculateVwap } from '../src/indicators/vwap';
import { calculateEma } from '../src/indicators/ema';
import { getSessionFromTimestamp } from '../src/session/session-utils';
import { computeMomentumAcumulado } from '../src/features/momentum.feature';
import { computeTarget } from '../src/labels/target.label';
import type { Candle } from '../src/types';
import type { CsvRow } from '../src/csv/csv-types';
import { getCsvHeader, rowToCsv } from '../src/csv/csv-writer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const DEFAULT_INPUT = path.join(DATA_DIR, 'training.csv');
const DEFAULT_OUTPUT = path.join(DATA_DIR, 'training-5m.csv');

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

interface ParsedRow {
  symbol: string;
  date: string;
  candle_time_et: string;
  candle_idx: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  atr: number;
  vwap: number | null;
  high_of_day: number;
  low_of_day: number;
  change_pct_at_candle: number;
  ema9: number | null;
  ema20: number | null;
  pre_market_high: number | null;
  session: string;
  shares_outstanding: number | null;
  market_cap: number | null;
  gap_pct: number | null;
  premarket_volume: number | null;
  momentum_acumulado: number | null;
  change_1m: number | null;
  change_5m: number | null;
  change_10m: number | null;
  minutes_since_hod: number | null;
  future_return_5m: number | null;
  target: number | null;
  target_break_hod_5m: number | null;
  max_future_return_10m: number | null;
}

const CSV_COLS = [
  'symbol', 'date', 'candle_time_et', 'candle_idx', 'open', 'high', 'low', 'close', 'volume',
  'atr', 'vwap', 'high_of_day', 'low_of_day', 'change_pct_at_candle', 'ema9', 'ema20',
  'pre_market_high', 'session',
  'shares_outstanding', 'market_cap', 'gap_pct', 'premarket_volume',
  'momentum_acumulado', 'change_1m', 'change_5m', 'change_10m', 'minutes_since_hod',
  'future_return_5m', 'target', 'target_break_hod_5m', 'max_future_return_10m',
] as const;

function toNum(v: string): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function parseRow(headers: string[], vals: string[]): ParsedRow | null {
  const get = (col: string) => {
    const i = headers.indexOf(col);
    return i >= 0 ? vals[i] ?? '' : '';
  };
  const num = (col: string) => toNum(get(col));
  const symbol = get('symbol') || '';
  const date = get('date') || '';
  if (!symbol || !date) return null;
  return {
    symbol,
    date,
    candle_time_et: get('candle_time_et') || '',
    candle_idx: num('candle_idx') ?? 0,
    open: num('open') ?? 0,
    high: num('high') ?? 0,
    low: num('low') ?? 0,
    close: num('close') ?? 0,
    volume: num('volume') ?? 0,
    atr: num('atr') ?? 0,
    vwap: num('vwap'),
    high_of_day: num('high_of_day') ?? 0,
    low_of_day: num('low_of_day') ?? 0,
    change_pct_at_candle: num('change_pct_at_candle') ?? 0,
    ema9: num('ema9'),
    ema20: num('ema20'),
    pre_market_high: num('pre_market_high'),
    session: get('session') || '',
    shares_outstanding: num('shares_outstanding'),
    market_cap: num('market_cap'),
    gap_pct: num('gap_pct'),
    premarket_volume: num('premarket_volume'),
    momentum_acumulado: num('momentum_acumulado'),
    change_1m: num('change_1m'),
    change_5m: num('change_5m'),
    change_10m: num('change_10m'),
    minutes_since_hod: num('minutes_since_hod'),
    future_return_5m: num('future_return_5m'),
    target: num('target'),
    target_break_hod_5m: num('target_break_hod_5m'),
    max_future_return_10m: num('max_future_return_10m'),
  };
}

/** ET "HH:MM" to minutes from midnight. */
function etToMinutes(et: string): number {
  const [h, m] = et.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minutes to ET "HH:MM". */
function minutesToEt(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Bucket key for 5-min: floor(minutes/5)*5. */
function bucketKey(et: string): number {
  return Math.floor(etToMinutes(et) / 5) * 5;
}

function main() {
  const args = process.argv.slice(2);
  let inputPath = DEFAULT_INPUT;
  let outputPath = DEFAULT_OUTPUT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputPath = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    }
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}. Run npm run build-csv first.`);
    process.exit(1);
  }

  const content = fs.readFileSync(inputPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length < 2) {
    console.error('CSV has no data rows.');
    process.exit(1);
  }

  const headers = parseCsvLine(lines[0]);
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const r = parseRow(headers, parseCsvLine(lines[i]));
    if (r) rows.push(r);
  }

  const byGroup = new Map<string, ParsedRow[]>();
  for (const r of rows) {
    const key = `${r.symbol}|${r.date}`;
    const list = byGroup.get(key) ?? [];
    list.push(r);
    byGroup.set(key, list);
  }

  for (const list of byGroup.values()) {
    list.sort((a, b) => a.candle_idx - b.candle_idx);
  }

  const output: CsvRow[] = [];
  let processed = 0;

  for (const [key, list] of byGroup) {
    const [symbol, date] = key.split('|');
    const buckets = new Map<number, ParsedRow[]>();
    for (const r of list) {
      const bk = bucketKey(r.candle_time_et);
      const b = buckets.get(bk) ?? [];
      b.push(r);
      buckets.set(bk, b);
    }

    const sortedBuckets = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
    const candles5m: Candle[] = [];
    const bucketMeta: { firstRow: ParsedRow; bucketMin: number }[] = [];

    for (const [bucketMin, bucketRows] of sortedBuckets) {
      if (bucketRows.length < 5) continue;
      const first = bucketRows[0];
      const last = bucketRows[bucketRows.length - 1];
      const o = first.open;
      const h = Math.max(...bucketRows.map((r) => r.high));
      const l = Math.min(...bucketRows.map((r) => r.low));
      const c = last.close;
      const v = bucketRows.reduce((s, r) => s + r.volume, 0);
      const t = new Date(`${date}T${minutesToEt(bucketMin)}:00-05:00`).getTime();
      if (isNaN(t)) continue;
      candles5m.push({ o, h, l, c, v, t });
      bucketMeta.push({ firstRow: first, bucketMin });
    }

    if (candles5m.length < 4) continue;

    const firstRow = list[0];
    const gapPct = firstRow.gap_pct;
    const firstRegularBucket = bucketMeta.find((m) => m.bucketMin >= 9 * 60 + 30);
    const openFirst = firstRegularBucket
      ? candles5m[bucketMeta.indexOf(firstRegularBucket)]?.o ?? candles5m[0]?.o ?? 0
      : candles5m[0]?.o ?? 0;
    const priorClose =
      gapPct != null && gapPct !== -1 && openFirst > 0
        ? openFirst / (1 + gapPct)
        : candles5m[0]?.o ?? 0;
    const openDay = candles5m[0]?.o ?? 0;

    const preMarketCandles = candles5m.filter((_, i) => {
      const m = bucketMeta[i]?.bucketMin ?? 0;
      return m < 9 * 60 + 30;
    });
    const preMarketHigh =
      preMarketCandles.length > 0
        ? Math.max(...preMarketCandles.map((c) => c.h))
        : null;
    const premarketVolume = preMarketCandles.reduce((s, c) => s + c.v, 0);

    const closes = candles5m.map((c) => c.c);
    const ema9Arr: (number | null)[] = [];
    const ema20Arr: (number | null)[] = [];
    for (let i = 0; i < closes.length; i++) {
      ema9Arr.push(calculateEma(closes.slice(0, i + 1), 9));
      ema20Arr.push(calculateEma(closes.slice(0, i + 1), 20));
    }

    for (let i = 0; i < candles5m.length; i++) {
      const c5 = candles5m[i];
      const candlesUpToNow = candles5m.slice(0, i + 1);
      const atr = calculateAtr(candlesUpToNow, 14);
      const vwap = calculateVwap(candlesUpToNow);
      const highOfDayUpToT = Math.max(...candlesUpToNow.map((c) => c.h));
      const lowOfDay = Math.min(...candlesUpToNow.map((c) => c.l));
      const changePct = priorClose > 0 ? (c5.c - priorClose) / priorClose : 0;
      const session = getSessionFromTimestamp(c5.t);

      const change5m = i >= 1 && closes[i - 1] > 0 ? (c5.c - closes[i - 1]) / closes[i - 1] : null;
      const change10m = i >= 2 && closes[i - 2] > 0 ? (c5.c - closes[i - 2]) / closes[i - 2] : null;

      let lastHodIdx = -1;
      for (let j = i; j >= 0; j--) {
        if (candles5m[j]?.h >= highOfDayUpToT - 1e-10) {
          lastHodIdx = j;
          break;
        }
      }
      const minutesSinceHod = lastHodIdx >= 0 ? (i - lastHodIdx) * 5 : null;

      const futureReturn5m =
        i + 1 < candles5m.length && c5.c > 0
          ? (candles5m[i + 1].c - c5.c) / c5.c
          : null;
      const target = computeTarget(futureReturn5m);
      const maxHighNext2 =
        i + 2 < candles5m.length
          ? Math.max(candles5m[i + 1].h, candles5m[i + 2].h)
          : i + 1 < candles5m.length
            ? candles5m[i + 1].h
            : 0;
      const targetBreakHod5m =
        i + 1 < candles5m.length
          ? candles5m[i + 1].h > highOfDayUpToT
            ? 1
            : 0
          : null;
      const maxFutureReturn10m =
        (i + 1 < candles5m.length || i + 2 < candles5m.length) && c5.c > 0
          ? (maxHighNext2 - c5.c) / c5.c
          : null;

      const momentumAcumulado = computeMomentumAcumulado(c5.c, openDay);

      const row: CsvRow = {
        symbol,
        date,
        candle_time_et: minutesToEt(bucketMeta[i]?.bucketMin ?? 0),
        candle_idx: i,
        open: c5.o,
        high: c5.h,
        low: c5.l,
        close: c5.c,
        volume: c5.v,
        atr,
        vwap,
        high_of_day: highOfDayUpToT,
        low_of_day: lowOfDay,
        change_pct_at_candle: changePct,
        ema9: ema9Arr[i] ?? null,
        ema20: ema20Arr[i] ?? null,
        pre_market_high: preMarketHigh,
        session,
        shares_outstanding: firstRow.shares_outstanding,
        market_cap: firstRow.market_cap,
        gap_pct: firstRow.gap_pct,
        premarket_volume: firstRow.premarket_volume ?? premarketVolume,
        momentum_acumulado: momentumAcumulado,
        change_1m: null,
        change_5m: change5m,
        change_10m: change10m,
        minutes_since_hod: minutesSinceHod,
        future_return_5m: futureReturn5m,
        target,
        target_break_hod_5m: targetBreakHod5m,
        max_future_return_10m: maxFutureReturn10m,
      };
      output.push(row);
    }
    processed++;
  }

  const header = getCsvHeader() + '\n';
  const body = output.map((row) => rowToCsv(row) + '\n').join('');
  fs.writeFileSync(outputPath, header + body, 'utf-8');
  console.log(`Resampled ${processed} symbol+date groups → ${output.length} rows → ${outputPath}`);
}

try {
  main();
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
