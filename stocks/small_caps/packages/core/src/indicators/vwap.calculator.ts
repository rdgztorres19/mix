import type { Candle } from '@small-caps/shared';

export interface VwapPoint {
  t: number;
  value: number;
}

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

  static calculateLine(candles: Candle[]): VwapPoint[] {
    const points: VwapPoint[] = [];
    let cumPV = 0;
    let cumV = 0;
    for (const c of candles) {
      const typical = (c.h + c.l + c.c) / 3;
      cumPV += typical * c.v;
      cumV += c.v;
      if (cumV > 0) points.push({ t: Math.floor(c.t / 1000), value: cumPV / cumV });
    }
    return points;
  }
}
