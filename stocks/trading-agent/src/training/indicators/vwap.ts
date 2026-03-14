// Duplicated from stock-training/src/indicators/vwap.ts - keep in sync for consistent features

import type { TrainingCandle } from '../types';

export function calculateVwap(candles: TrainingCandle[]): number | null {
  if (!candles.length) return null;
  let totalPV = 0;
  let totalV = 0;
  for (const c of candles) {
    const typical = (c.h + c.l + c.c) / 3;
    totalPV += typical * c.v;
    totalV += c.v;
  }
  return totalV > 0 ? totalPV / totalV : null;
}
