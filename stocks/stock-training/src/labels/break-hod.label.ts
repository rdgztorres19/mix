/**
 * Break HOD label.
 * Single responsibility: 1 if max(high[t+1..t+5]) > highOfDayUpToT, 0 otherwise
 */

import type { Candle } from '../types';

export function computeTargetBreakHod5m(
  candles: Candle[],
  idx: number,
  highOfDayUpToT: number,
): number | null {
  if (idx + 5 >= candles.length) return null;
  let maxHigh = 0;
  for (let j = idx + 1; j <= idx + 5; j++) {
    if (candles[j]?.h > maxHigh) maxHigh = candles[j].h;
  }
  return maxHigh > highOfDayUpToT ? 1 : 0;
}
