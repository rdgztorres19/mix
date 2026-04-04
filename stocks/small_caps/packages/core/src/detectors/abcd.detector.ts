import type { Candle, PatternResult } from '@small-caps/shared';

export class AbcdDetector {
  private readonly WINDOW = 20;
  private readonly MIN_AB_CANDLES = 3; // A→B must span at least 3 candles
  private readonly MIN_BC_CANDLES = 2; // B→C must span at least 2 candles
  private readonly MAX_BC_RETRACE = 0.70; // BC retrace max 70% of AB
  private readonly MIN_BC_RETRACE = 0.30; // BC retrace min 30% (too shallow = not a real pullback)

  detect(candles: Candle[]): PatternResult {
    const empty: PatternResult = { detected: false, name: 'ABCD', anchor_points: [], description: '' };
    if (candles.length < 10) return empty;

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

      // C must be higher low than A
      if (cCandle.l <= aCandle.l) continue;
      // B must be highest point
      if (bCandle.h <= aCandle.h || bCandle.h <= cCandle.h) continue;

      // Minimum span: A→B at least 3 candles, B→C at least 2
      if (bIdx - aIdx < this.MIN_AB_CANDLES) continue;
      if (cIdx - bIdx < this.MIN_BC_CANDLES) continue;

      const abRange = bCandle.h - aCandle.l;
      if (abRange <= 0) continue;

      // AB move must be significant (at least 1% of price)
      const abPct = abRange / aCandle.l;
      if (abPct < 0.01) continue;

      const bcRetrace = (bCandle.h - cCandle.l) / abRange;
      if (bcRetrace > this.MAX_BC_RETRACE) continue;
      if (bcRetrace < this.MIN_BC_RETRACE) continue;

      // D forming: candles after C should be moving up
      const postC = window.slice(cIdx + 1);
      if (postC.length < 1) continue;
      const dCandle = postC[postC.length - 1];
      const dForming = dCandle.c > cCandle.l && dCandle.c > dCandle.o; // green candle above C

      const points = [
        { label: 'A', price: aCandle.l, time: aCandle.t },
        { label: 'B', price: bCandle.h, time: bCandle.t },
        { label: 'C', price: cCandle.l, time: cCandle.t },
      ];
      if (dForming) {
        points.push({ label: 'D', price: dCandle.h, time: dCandle.t });
      }

      return {
        detected: true,
        name: 'ABCD',
        anchor_points: points,
        description: `ABCD: A=$${aCandle.l.toFixed(2)} → B=$${bCandle.h.toFixed(2)} (${(abPct * 100).toFixed(1)}%) → C=$${cCandle.l.toFixed(2)} (${(bcRetrace * 100).toFixed(0)}% retrace)${dForming ? ' → D forming' : ''}`,
      };
    }
    return empty;
  }

  private findSwingHighs(candles: Candle[]): number[] {
    const result: number[] = [];
    for (let i = 2; i < candles.length - 2; i++) {
      // Require 2 candles on each side to confirm swing
      if (candles[i].h > candles[i - 1].h && candles[i].h > candles[i - 2].h &&
          candles[i].h > candles[i + 1].h && candles[i].h > candles[i + 2].h) {
        result.push(i);
      }
    }
    return result;
  }

  private findSwingLows(candles: Candle[]): number[] {
    const result: number[] = [];
    for (let i = 2; i < candles.length - 2; i++) {
      if (candles[i].l < candles[i - 1].l && candles[i].l < candles[i - 2].l &&
          candles[i].l < candles[i + 1].l && candles[i].l < candles[i + 2].l) {
        result.push(i);
      }
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
