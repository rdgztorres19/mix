/**
 * Facade: computes a full CandleRow from running candle history + metadata.
 * Ported from trading-agent/src/collector/indicator.calculator.ts
 */
import type { Candle, CandleRow, SymbolMetadata } from '@small-caps/shared';
import { getSessionFromTimestamp } from '../session.utils';
import { VwapCalculator } from './vwap.calculator';
import { EmaCalculator } from './ema.calculator';
import { AtrCalculator } from './atr.calculator';
import { ATR_PERIOD, EMA9_PERIOD, EMA20_PERIOD } from '@small-caps/shared';

/** Convert a unix ms timestamp to ET date string and time string. */
export function timestampToET(ms: number): { date: string; time: string; minuteOfDay: number } {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
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
  history: Candle[],
  metadata: SymbolMetadata,
): CandleRow {
  const candle = history[history.length - 1];
  const n = history.length;
  const { date, time } = timestampToET(candle.t);

  const candle_idx = n - 1;

  // VWAP
  const vwap = VwapCalculator.calculate(history) ?? 0;

  // EMA9 & EMA20
  const closes = history.map((c) => c.c);
  const ema9 = EmaCalculator.calculate(closes, EMA9_PERIOD) ?? 0;
  const ema20 = EmaCalculator.calculate(closes, EMA20_PERIOD) ?? 0;

  // ATR
  const atr = AtrCalculator.calculate(history, ATR_PERIOD);

  // High/Low of day
  let high_of_day = -Infinity;
  let low_of_day = Infinity;
  for (const c of history) {
    if (c.h > high_of_day) high_of_day = c.h;
    if (c.l < low_of_day) low_of_day = c.l;
  }

  // Change % from prior close
  const change_pct_at_candle =
    metadata.priorClose > 0 ? (candle.c - metadata.priorClose) / metadata.priorClose : 0;

  // Session
  const session = getSessionFromTimestamp(candle.t);

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
    timestamp_ms: candle.t,
  };
}
