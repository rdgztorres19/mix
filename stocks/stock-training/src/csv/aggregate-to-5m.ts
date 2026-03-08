/**
 * Aggregate 1-min candles to 5-min CsvRows.
 * Used by build-training-csv to generate training-5m.csv in the same pass.
 */

import { calculateAtr } from '../indicators/atr';
import { calculateVwap } from '../indicators/vwap';
import { calculateEma } from '../indicators/ema';
import { getSessionFromTimestamp } from '../session/session-utils';
import { computeMomentumAcumulado } from '../features/momentum.feature';
import { computeTarget } from '../labels/target.label';
import type { Candle } from '../types';
import type { CsvRow } from './csv-types';
import type { Fundamentals } from '../data/fundamental-fetcher';

function etToMinutes(tsMs: number): number {
  const d = new Date(tsMs);
  const etStr = d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const [h, m] = etStr.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToEt(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function bucketKey(tsMs: number): number {
  return Math.floor(etToMinutes(tsMs) / 5) * 5;
}

export interface Aggregate5mInput {
  candles: Candle[];
  symbol: string;
  date: string;
  priorClose: number;
  openDay: number;
  openFirst: number;
  fundamentals: Fundamentals;
  premarketVolume: number;
  preMarketHigh: number | null;
  isInWindow: (tsMs: number) => boolean;
}

/**
 * Aggregate 1-min candles to 5-min rows. Only includes buckets where all 5
 * component candles pass isInWindow.
 */
export function aggregateCandlesTo5mRows(input: Aggregate5mInput): CsvRow[] {
  const {
    candles,
    symbol,
    date,
    priorClose,
    openDay,
    openFirst,
    fundamentals,
    premarketVolume,
    preMarketHigh,
    isInWindow,
  } = input;

  const buckets = new Map<number, Candle[]>();
  for (const c of candles) {
    const bk = bucketKey(c.t);
    const list = buckets.get(bk) ?? [];
    list.push(c);
    buckets.set(bk, list);
  }

  const sortedBuckets = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const candles5m: Candle[] = [];
  const bucketMins: number[] = [];

  for (const [bucketMin, bucketRows] of sortedBuckets) {
    if (bucketRows.length < 5) continue;
    const allInWindow = bucketRows.every((c) => isInWindow(c.t));
    if (!allInWindow) continue;
    const first = bucketRows[0];
    const last = bucketRows[bucketRows.length - 1];
    const o = first.o;
    const h = Math.max(...bucketRows.map((c) => c.h));
    const l = Math.min(...bucketRows.map((c) => c.l));
    const c = last.c;
    const v = bucketRows.reduce((s, r) => s + r.v, 0);
    const t = first.t;
    candles5m.push({ o, h, l, c, v, t });
    bucketMins.push(bucketMin);
  }

  if (candles5m.length < 4) return [];

  const gapPct = priorClose > 0 && openFirst > 0 ? (openFirst - priorClose) / priorClose : null;
  const closes = candles5m.map((c) => c.c);
  const ema9Arr: (number | null)[] = [];
  const ema20Arr: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    ema9Arr.push(calculateEma(closes.slice(0, i + 1), 9));
    ema20Arr.push(calculateEma(closes.slice(0, i + 1), 20));
  }

  const preMarketCandles = candles5m.filter((_, i) => (bucketMins[i] ?? 0) < 9 * 60 + 30);
  const premarketVol5m = preMarketCandles.reduce((s, c) => s + c.v, 0);

  const output: CsvRow[] = [];
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
      i + 1 < candles5m.length && c5.c > 0 ? (candles5m[i + 1].c - c5.c) / c5.c : null;
    const target = computeTarget(futureReturn5m);
    const maxHighNext2 =
      i + 2 < candles5m.length
        ? Math.max(candles5m[i + 1].h, candles5m[i + 2].h)
        : i + 1 < candles5m.length
          ? candles5m[i + 1].h
          : 0;
    const targetBreakHod5m =
      i + 1 < candles5m.length ? (candles5m[i + 1].h > highOfDayUpToT ? 1 : 0) : null;
    const maxFutureReturn10m =
      (i + 1 < candles5m.length || i + 2 < candles5m.length) && c5.c > 0
        ? (maxHighNext2 - c5.c) / c5.c
        : null;

    const momentumAcumulado = computeMomentumAcumulado(c5.c, openDay);

    output.push({
      symbol,
      date,
      candle_time_et: minutesToEt(bucketMins[i] ?? 0),
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
      shares_outstanding: fundamentals.sharesOutstanding,
      market_cap: fundamentals.marketCap,
      gap_pct: gapPct,
      premarket_volume: premarketVol5m,
      momentum_acumulado: momentumAcumulado,
      change_1m: null,
      change_5m: change5m,
      change_10m: change10m,
      minutes_since_hod: minutesSinceHod,
      future_return_5m: futureReturn5m,
      target,
      target_break_hod_5m: targetBreakHod5m,
      max_future_return_10m: maxFutureReturn10m,
    });
  }
  return output;
}
