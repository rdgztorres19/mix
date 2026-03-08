import type { Candle } from '../types';

/**
 * ATR calculator — Average True Range.
 * TR = max(H-L, |H-PrevC|, |L-PrevC|). ATR = SMA of last N TRs.
 */
export class AtrCalculator {
  static calculate(candles: Candle[], period = 14): number {
    if (candles.length < 2) return 0;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const cur = candles[i];
      trs.push(
        Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)),
      );
    }
    const slice = trs.slice(-period);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  }
}
