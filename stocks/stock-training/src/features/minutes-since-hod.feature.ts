/**
 * Minutes since high of day feature.
 * Single responsibility: minutes since last candle where high = HOD (up to current idx)
 */

import type { Candle } from '../types';

export function computeMinutesSinceHod(
  candles: Candle[],
  idx: number,
  highOfDayUpToT: number,
): number | null {
  let lastHodIdx = -1;
  for (let j = idx; j >= 0; j--) {
    if (candles[j]?.h >= highOfDayUpToT - 1e-10) {
      lastHodIdx = j;
      break;
    }
  }
  if (lastHodIdx < 0) return null;
  return idx - lastHodIdx;
}
