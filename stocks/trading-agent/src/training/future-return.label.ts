// Duplicated from stock-training/src/labels/future-return.label.ts - keep in sync for consistent features

import type { TrainingCandle } from './types';

export function computeFutureReturn5m(candles: TrainingCandle[], idx: number): number | null {
  if (idx + 5 >= candles.length) return null;
  const closeT = candles[idx].c;
  const closeT5 = candles[idx + 5].c;
  if (closeT <= 0) return null;
  return (closeT5 - closeT) / closeT;
}
