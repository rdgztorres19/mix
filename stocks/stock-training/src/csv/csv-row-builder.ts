/**
 * CSV row builder.
 * Single responsibility: assemble CsvRow from indicators, features, labels, fundamentals, news.
 */

import type { Candle } from '../types';
import type { CsvRow } from './csv-types';
import type { Fundamentals } from '../data/fundamental-fetcher';
import { computeGapPct } from '../features/gap.feature';
import { computePremarketVolume } from '../features/premarket-volume.feature';
import { computeChange } from '../features/change.feature';
import { computeMinutesSinceHod } from '../features/minutes-since-hod.feature';
import { computeMomentumAcumulado } from '../features/momentum.feature';
import { computeFutureReturn5m } from '../labels/future-return.label';
import { computeTarget } from '../labels/target.label';
import { computeTargetBreakHod5m } from '../labels/break-hod.label';
import { computeMaxFutureReturn10m } from '../labels/max-future-return.label';

export interface BuildRowInput {
  symbol: string;
  date: string;
  candle: Candle;
  candleIdx: number;
  candleTimeEt: string;
  atr: number;
  vwap: number | null;
  highOfDay: number;
  lowOfDay: number;
  changePctAtCandle: number;
  ema9: number | null;
  ema20: number | null;
  preMarketHigh: number | null;
  session: string;
  fundamentals: Fundamentals;
  candles: Candle[];
  priorClose: number;
  openDay: number;
  openFirst: number;
  premarketVolume: number;
}

export function buildCsvRow(input: BuildRowInput): CsvRow {
  const {
    symbol,
    date,
    candle,
    candleIdx,
    candleTimeEt,
    atr,
    vwap,
    highOfDay,
    lowOfDay,
    changePctAtCandle,
    ema9,
    ema20,
    preMarketHigh,
    session,
    fundamentals,
    candles,
    priorClose,
    openDay,
    openFirst,
    premarketVolume,
  } = input;

  const highOfDayUpToT = Math.max(...candles.slice(0, candleIdx + 1).map((c) => c.h));

  const gapPct = computeGapPct(priorClose, openFirst);
  const change = computeChange(candles, candleIdx);
  const minutesSinceHod = computeMinutesSinceHod(candles, candleIdx, highOfDayUpToT);
  const momentumAcumulado = computeMomentumAcumulado(candle.c, openDay);

  const futureReturn5m = computeFutureReturn5m(candles, candleIdx);
  const target = computeTarget(futureReturn5m);
  const targetBreakHod5m = computeTargetBreakHod5m(candles, candleIdx, highOfDayUpToT);
  const maxFutureReturn10m = computeMaxFutureReturn10m(candles, candleIdx);

  return {
    symbol,
    date,
    candle_time_et: candleTimeEt,
    candle_idx: candleIdx,
    open: candle.o,
    high: candle.h,
    low: candle.l,
    close: candle.c,
    volume: candle.v,
    atr,
    vwap,
    high_of_day: highOfDayUpToT,
    low_of_day: lowOfDay,
    change_pct_at_candle: changePctAtCandle,
    ema9,
    ema20,
    pre_market_high: preMarketHigh,
    session,
    shares_outstanding: fundamentals.sharesOutstanding,
    market_cap: fundamentals.marketCap,
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
