/**
 * Max future return 10m label.
 * Single responsibility: (max(high[t+1..t+10]) - close[t]) / close[t]
 */

import type { Candle } from '../types';

export function computeMaxFutureReturn10m(candles: Candle[], idx: number): number | null {
  if (idx + 10 >= candles.length) return null;
  const closeT = candles[idx].c;
  if (closeT <= 0) return null;
  let maxHigh = 0;
  for (let j = idx + 1; j <= idx + 10; j++) {
    if (candles[j]?.h > maxHigh) maxHigh = candles[j].h;
  }
  return (maxHigh - closeT) / closeT;
}
