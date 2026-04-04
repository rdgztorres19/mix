import type { Candle, PatternResult } from '@small-caps/shared';

export class AbcdDetector {
  private readonly WINDOW = 20;

  detect(candles: Candle[]): PatternResult {
    const empty: PatternResult = { detected: false, name: 'ABCD', anchor_points: [], description: '' };
    if (candles.length < 8) return empty;

    const window = candles.slice(-this.WINDOW);
    const highs = this.findSwingHighs(window);
    const lows = this.findSwingLows(window);

    if (highs.length < 1 || lows.length < 2) return empty;

    for (let ci = lows.length - 1; ci >= 1; ci--) {
      const cIdx = lows[ci];
      const cCandle = window[cIdx];
      const bIdx = this.lastBefore(highs, cIdx);
      if (bIdx === null) continue;
      const bCandle = window[bIdx];
      const aIdx = this.lastBefore(lows, bIdx);
      if (aIdx === null) continue;
      const aCandle = window[aIdx];

      if (cCandle.l <= aCandle.l) continue;
      if (bCandle.h <= aCandle.h || bCandle.h <= cCandle.h) continue;

      const abRange = bCandle.h - aCandle.l;
      if (abRange <= 0) continue;

      const bcRetrace = (bCandle.h - cCandle.l) / abRange;
      if (bcRetrace > 0.8) continue;

      const postC = window.slice(cIdx + 1);
      const dCandle = postC.length > 0 ? postC[postC.length - 1] : null;
      const dForming = dCandle && dCandle.c > cCandle.l;

      const points = [
        { label: 'A', price: aCandle.l, time: aCandle.t },
        { label: 'B', price: bCandle.h, time: bCandle.t },
        { label: 'C', price: cCandle.l, time: cCandle.t },
      ];
      if (dCandle && dForming) {
        points.push({ label: 'D', price: dCandle.h, time: dCandle.t });
      }

      return {
        detected: true,
        name: 'ABCD',
        anchor_points: points,
        description: `ABCD: A=$${aCandle.l.toFixed(2)} → B=$${bCandle.h.toFixed(2)} → C=$${cCandle.l.toFixed(2)} (${(bcRetrace * 100).toFixed(0)}% retrace)${dForming ? ' → D forming' : ''}`,
      };
    }
    return empty;
  }

  private findSwingHighs(candles: Candle[]): number[] {
    const result: number[] = [];
    for (let i = 1; i < candles.length - 1; i++) {
      if (candles[i].h > candles[i - 1].h && candles[i].h > candles[i + 1].h) result.push(i);
    }
    return result;
  }

  private findSwingLows(candles: Candle[]): number[] {
    const result: number[] = [];
    for (let i = 1; i < candles.length - 1; i++) {
      if (candles[i].l < candles[i - 1].l && candles[i].l < candles[i + 1].l) result.push(i);
    }
    return result;
  }

  private lastBefore(arr: number[], before: number): number | null {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] < before) return arr[i];
    }
    return null;
  }
}
