import type { Candle } from '../types';

/**
 * VWAP — Volume Weighted Average Price.
 * Typical price (H+L+C)/3, weighted by volume.
 */
export function calculateVwap(candles: Candle[]): number | null {
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
