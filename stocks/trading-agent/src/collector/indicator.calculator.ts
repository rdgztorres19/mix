/**
 * Per-candle indicator calculator for the collector pipeline.
 * Computes VWAP, EMA9, EMA20, ATR, HOD, LOD, session, change_pct, etc.
 * from the running candle history of each symbol.
 * Uses training/* modules for session, change, minutes_since_hod, and target columns.
 */

import { getSessionFromTimestamp } from '../training/session-utils';
import { computeChange } from '../training/change.feature';
import { computeMinutesSinceHod } from '../training/minutes-since-hod.feature';
import { computeMomentumAcumulado } from '../training/momentum.feature';
import { computeFutureReturn5m } from '../training/future-return.label';
import { computeTarget } from '../training/target.label';
import { computeTargetBreakHod5m } from '../training/break-hod.label';
import { computeMaxFutureReturn10m } from '../training/max-future-return.label';

export interface CollectorCandle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number; // unix ms
}

export interface SymbolMetadata {
  priorClose: number;
  preMarketHigh: number;
  sharesOutstanding: number | null;
  marketCap: number | null;
  gapPct: number;
  premarketVolume: number;
}

export interface CandleRow {
  symbol: string;
  date: string;       // YYYY-MM-DD
  candle_idx: number;
  candle_time_et: string; // HH:MM
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  atr: number;
  vwap: number;
  ema9: number;
  ema20: number;
  high_of_day: number;
  low_of_day: number;
  change_pct_at_candle: number;
  pre_market_high: number;
  session: string;
  shares_outstanding: number | null;
  market_cap: number | null;
  gap_pct: number;
  premarket_volume: number;
  change_1m: number;
  change_5m: number;
  change_10m: number;
  minutes_since_hod: number;
  momentum_acumulado: number | null;
  future_return_5m?: number | null;
  target?: number | null;
  target_break_hod_5m?: number | null;
  max_future_return_10m?: number | null;
  // Keep original timestamp for accurate UI formatting
  original_timestamp_ms?: number;
}

const ATR_PERIOD = 14;

/**
 * Convert a unix ms timestamp to ET date string (YYYY-MM-DD) and time string (HH:MM).
 */
export function timestampToET(ms: number): { date: string; time: string; minuteOfDay: number } {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const h = parseInt(get('hour'), 10);
  const m = parseInt(get('minute'), 10);
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return { date, time, minuteOfDay: h * 60 + m };
}

/**
 * Compute a full CandleRow from the running history of candles + metadata.
 * `history` must include the current candle as the last element.
 */
export function computeCandleRow(
  symbol: string,
  history: CollectorCandle[],
  metadata: SymbolMetadata,
): CandleRow {
  const candle = history[history.length - 1];
  const n = history.length;
  const { date, time } = timestampToET(candle.t);

  // Candle index: count from 0 for today
  const candle_idx = n - 1;

  // VWAP
  const vwap = calculateVwap(history);

  // EMA9 & EMA20
  const ema9 = computeEma(history.map((c) => c.c), 9);
  const ema20 = computeEma(history.map((c) => c.c), 20);

  // ATR (last ATR_PERIOD candles)
  const atr = computeAtr(history, ATR_PERIOD);

  // High/Low of day (running)
  let high_of_day = -Infinity;
  let low_of_day = Infinity;
  for (const c of history) {
    if (c.h > high_of_day) high_of_day = c.h;
    if (c.l < low_of_day) low_of_day = c.l;
  }

  // Change % from prior close
  const change_pct_at_candle =
    metadata.priorClose > 0 ? (candle.c - metadata.priorClose) / metadata.priorClose : 0;

  // Change 1m, 5m, 10m and minutes_since_hod from training modules (unified with stock-training)
  const change = computeChange(history as unknown as import('../training/types').TrainingCandle[], candle_idx);
  const change_1m = change.change_1m ?? 0;
  const change_5m = change.change_5m ?? 0;
  const change_10m = change.change_10m ?? 0;

  const minutesSinceHod = computeMinutesSinceHod(
    history as unknown as import('../training/types').TrainingCandle[],
    candle_idx,
    high_of_day,
  );
  const minutes_since_hod = minutesSinceHod ?? candle_idx;

  // Session: PRE_MARKET, THE_OPEN, etc. (unified with stock-training)
  const session = getSessionFromTimestamp(candle.t);

  // Target columns when enough future candles exist
  const future_return_5m = computeFutureReturn5m(
    history as unknown as import('../training/types').TrainingCandle[],
    candle_idx,
  );
  const target = computeTarget(future_return_5m ?? null);
  const target_break_hod_5m = computeTargetBreakHod5m(
    history as unknown as import('../training/types').TrainingCandle[],
    candle_idx,
    high_of_day,
  );
  const max_future_return_10m = computeMaxFutureReturn10m(
    history as unknown as import('../training/types').TrainingCandle[],
    candle_idx,
  );

  const openDay = history.length > 0 ? history[0].o : candle.c;
  const momentum_acumulado = computeMomentumAcumulado(candle.c, openDay);

  return {
    symbol: symbol.toUpperCase(),
    date,
    candle_idx,
    candle_time_et: time,
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
    volume: candle.v,
    atr,
    vwap,
    ema9,
    ema20,
    high_of_day,
    low_of_day,
    change_pct_at_candle,
    pre_market_high: metadata.preMarketHigh,
    session,
    shares_outstanding: metadata.sharesOutstanding,
    market_cap: metadata.marketCap,
    gap_pct: metadata.gapPct,
    premarket_volume: metadata.premarketVolume,
    change_1m,
    change_5m,
    change_10m,
    minutes_since_hod,
    momentum_acumulado,
    future_return_5m: future_return_5m ?? undefined,
    target: target ?? undefined,
    target_break_hod_5m: target_break_hod_5m ?? undefined,
    max_future_return_10m: max_future_return_10m ?? undefined,
    original_timestamp_ms: candle.t,
  };
}

function calculateVwap(candles: CollectorCandle[]): number | null {
  if (!candles.length) return null;
  let totalPV = 0;
  let totalV = 0;
  for (const c of candles) {
    const typical = (c.h + c.l + c.c) / 3;
    totalPV += typical * c.v;
    totalV += c.v;
  }
  return totalV > 0 ? totalPV / totalV : null;
}


function computeEma(values: number[], period: number): number {
  if (!values.length) return 0;
  if (values.length < period) {
    // Not enough data → simple average
    return values.reduce((s, v) => s + v, 0) / values.length;
  }
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeAtr(candles: CollectorCandle[], period: number): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    trs.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)));
  }
  const slice = trs.slice(-period);
  return slice.length > 0 ? slice.reduce((s, v) => s + v, 0) / slice.length : 0;
}
