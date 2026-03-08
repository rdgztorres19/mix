/**
 * Future return 5m label.
 * Single responsibility: compute future_return_5m = (close[t+5] - close[t]) / close[t]
 */

import type { Candle } from '../types';

export function computeFutureReturn5m(candles: Candle[], idx: number): number | null {
  if (idx + 5 >= candles.length) return null;
  const closeT = candles[idx].c;
  const closeT5 = candles[idx + 5].c;
  if (closeT <= 0) return null;
  return (closeT5 - closeT) / closeT;
}
