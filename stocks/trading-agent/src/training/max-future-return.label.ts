// Duplicated from stock-training/src/labels/max-future-return.label.ts - keep in sync for consistent features

import type { TrainingCandle } from './types';

export function computeMaxFutureReturn10m(candles: TrainingCandle[], idx: number): number | null {
  if (idx + 10 >= candles.length) return null;
  const closeT = candles[idx].c;
  if (closeT <= 0) return null;
  let maxHigh = 0;
  for (let j = idx + 1; j <= idx + 10; j++) {
    if (candles[j]?.h > maxHigh) maxHigh = candles[j].h;
  }
  return (maxHigh - closeT) / closeT;
}
