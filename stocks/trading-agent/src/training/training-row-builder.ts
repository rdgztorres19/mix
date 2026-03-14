/**
 * Training row builder.
 * Duplicated from stock-training/src/csv/csv-row-builder.ts - keep in sync for consistent features.
 * Adapted to output MySQL CandleRow format compatible with training_1m table.
 */

import type { TrainingCandle } from './types';
import { computeGapPct } from './gap.feature';
import { computePremarketVolume } from './premarket-volume.feature';
import { computeChange } from './change.feature';
import { computeMinutesSinceHod } from './minutes-since-hod.feature';
import { computeMomentumAcumulado } from './momentum.feature';
import { computeFutureReturn5m } from './future-return.label';
import { computeTarget } from './target.label';
import { computeTargetBreakHod5m } from './break-hod.label';
import { computeMaxFutureReturn10m } from './max-future-return.label';
import { getSessionFromTimestamp } from './session-utils';
import { calculateVwap } from './indicators/vwap';
import { calculateEma } from './indicators/ema';
import { calculateAtr } from './indicators/atr';

export interface TrainingRowOutput {
  symbol: string;
  date: string;
  candle_idx: number;
  candle_time_et: string;
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
  gap_pct: number | null;
  premarket_volume: number;
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

export interface BuildTrainingRowInput {
  symbol: string;
  date: string;
  candles: TrainingCandle[];
  idx: number;
  priorClose: number;
  openDay: number;
  openFirst: number;
  premarketVolume: number;
  preMarketHigh: number | null;
  sharesOutstanding?: number | null;
  marketCap?: number | null;
}

export function buildTrainingRow(input: BuildTrainingRowInput): TrainingRowOutput {
  const {
    symbol,
    date,
    candles,
    idx,
    priorClose,
    openDay,
    openFirst,
    premarketVolume,
    preMarketHigh,
    sharesOutstanding = null,
    marketCap = null,
  } = input;

  const candle = candles[idx];
  const candlesUpToNow = candles.slice(0, idx + 1);

  // Indicators (same logic as build-training-csv)
  const closes = candlesUpToNow.map((c) => c.c);
  const ema9 = calculateEma(closes, 9);
  const ema20 = calculateEma(closes, 20);
  const atr = calculateAtr(candlesUpToNow, 14);
  const vwap = calculateVwap(candlesUpToNow);

  const highOfDay = Math.max(...candlesUpToNow.map((c) => c.h));
  const lowOfDay = Math.min(...candlesUpToNow.map((c) => c.l));
  const highOfDayUpToT = highOfDay;

  const changePctAtCandle = priorClose > 0 ? (candle.c - priorClose) / priorClose : 0;
  const session = getSessionFromTimestamp(candle.t);

  const candleTimeEt = new Date(candle.t).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const gapPct = computeGapPct(priorClose, openFirst);
  const change = computeChange(candles, idx);
  const minutesSinceHod = computeMinutesSinceHod(candles, idx, highOfDayUpToT);
  const momentumAcumulado = computeMomentumAcumulado(candle.c, openDay);

  const futureReturn5m = computeFutureReturn5m(candles, idx);
  const target = computeTarget(futureReturn5m);
  const targetBreakHod5m = computeTargetBreakHod5m(candles, idx, highOfDayUpToT);
  const maxFutureReturn10m = computeMaxFutureReturn10m(candles, idx);

  return {
    symbol: symbol.toUpperCase(),
    date,
    candle_idx: idx,
    candle_time_et: candleTimeEt,
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
    volume: candle.v,
    atr,
    vwap: vwap ?? candle.c,
    ema9: ema9 ?? candle.c,
    ema20: ema20 ?? candle.c,
    high_of_day: highOfDayUpToT,
    low_of_day: lowOfDay,
    change_pct_at_candle: changePctAtCandle,
    pre_market_high: preMarketHigh ?? 0,
    session,
    shares_outstanding: sharesOutstanding,
    market_cap: marketCap,
    gap_pct: gapPct,
    premarket_volume: premarketVolume,
    momentum_acumulado: momentumAcumulado,
    change_1m: change.change_1m,
    change_5m: change.change_5m,
    change_10m: change.change_10m,
    minutes_since_hod: minutesSinceHod,
    future_return_5m: futureReturn5m,
    target,
    target_break_hod_5m: targetBreakHod5m,
    max_future_return_10m: maxFutureReturn10m,
  };
}
