// Duplicated from stock-training/src/features/minutes-since-hod.feature.ts - keep in sync for consistent features

import type { TrainingCandle } from './types';

export function computeMinutesSinceHod(
  candles: TrainingCandle[],
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
