import type { Candle } from '../types';

export interface VwapPoint {
  t: number; // unix seconds
  value: number;
}

/**
 * VWAP calculator — Volume Weighted Average Price.
 * Typical price (H+L+C)/3, weighted by volume.
 */
export class VwapCalculator {
  static calculate(candles: Candle[]): number | null {
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

  /** Cumulative VWAP points per candle for chart. */
  static calculateLine(candles: Candle[]): VwapPoint[] {
    const points: VwapPoint[] = [];
    let cumPV = 0,
      cumV = 0;
    for (const c of candles) {
      const typical = (c.h + c.l + c.c) / 3;
      cumPV += typical * c.v;
      cumV += c.v;
      if (cumV > 0) points.push({ t: Math.floor(c.t / 1000), value: cumPV / cumV });
    }
    return points;
  }
}
