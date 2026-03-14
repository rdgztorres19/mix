// Duplicated from stock-training/src/labels/break-hod.label.ts - keep in sync for consistent features

import type { TrainingCandle } from './types';

export function computeTargetBreakHod5m(
  candles: TrainingCandle[],
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
