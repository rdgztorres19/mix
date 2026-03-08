import type { Candle, PatternResult } from '../types';

/**
 * Bull Flag detector — scans for a pole (3+ mostly-green candles moving up)
 * followed by a flag (2+ consolidation candles) with < 50% retracement.
 * Also detects when the breakout candle has already fired (post-breakout).
 */
export class BullFlagDetector {
  private readonly WINDOW = 20;
  private readonly MIN_POLE = 3;
  private readonly MIN_FLAG = 2;
  private readonly MAX_RETRACE_PCT = 50;

  detect(candles: Candle[]): PatternResult {
    const empty: PatternResult = { detected: false, name: 'BULL_FLAG', anchor_points: [], description: '' };
    if (candles.length < this.MIN_POLE + this.MIN_FLAG) return empty;

    const window = candles.slice(-this.WINDOW);

    // Try the raw window first, then try excluding trailing breakout candles (1 or 2)
    for (const trimEnd of [0, 1, 2]) {
      const trimmed = trimEnd > 0 ? window.slice(0, -trimEnd) : window;
      if (trimmed.length < this.MIN_POLE + this.MIN_FLAG) continue;
      const result = this.scanWindow(trimmed, trimEnd > 0);
      if (result.detected) return result;
    }

    return empty;
  }

  private scanWindow(window: Candle[], isPostBreakout: boolean): PatternResult {
    const empty: PatternResult = { detected: false, name: 'BULL_FLAG', anchor_points: [], description: '' };

    for (let flagEnd = window.length - 1; flagEnd >= this.MIN_POLE + this.MIN_FLAG - 1; flagEnd--) {
      for (let splitIdx = flagEnd - this.MIN_FLAG + 1; splitIdx >= this.MIN_POLE; splitIdx--) {
        let bestPoleStart = splitIdx - this.MIN_POLE;
        for (let ps = 0; ps < splitIdx - this.MIN_POLE; ps++) {
          if (this.isValidPole(window.slice(ps, splitIdx))) {
            bestPoleStart = ps;
            break;
          }
        }

        const poleCandles = window.slice(bestPoleStart, splitIdx);
        const flagCandles = window.slice(splitIdx, flagEnd + 1);

        if (!this.isValidPole(poleCandles) || !this.isValidFlag(flagCandles)) continue;

        const poleStart = poleCandles[0].o;
        const poleHigh = Math.max(...poleCandles.map((c) => c.h));
        const flagLow = Math.min(...flagCandles.map((c) => c.l));

        const flagHigh = Math.max(...flagCandles.map((c) => c.h));
        if (flagHigh > poleHigh) continue;

        const poleRange = poleHigh - poleStart;
        if (poleRange <= 0) continue;

        const retracePct = ((poleHigh - flagLow) / poleRange) * 100;
        if (retracePct >= this.MAX_RETRACE_PCT) continue;

        const avgPoleVol = poleCandles.reduce((s, c) => s + c.v, 0) / poleCandles.length;
        const avgFlagVol = flagCandles.reduce((s, c) => s + c.v, 0) / flagCandles.length;
        const volumeDecreasing = avgFlagVol < avgPoleVol;

        const phase = isPostBreakout ? ' [breakout]' : '';

        return {
          detected: true,
          name: 'BULL_FLAG',
          anchor_points: [
            { label: 'PoleStart', price: poleStart, time: poleCandles[0].t },
            { label: 'PoleHigh', price: poleHigh, time: poleCandles[poleCandles.length - 1].t },
            { label: 'FlagLow', price: flagLow, time: flagCandles[flagCandles.length - 1].t },
          ],
          description: `Bull Flag: ${retracePct.toFixed(0)}% retrace${volumeDecreasing ? ', vol decreasing' : ''} (pole ${poleCandles.length}, flag ${flagCandles.length})${phase}`,
        };
      }
    }

    return empty;
  }

  /** Pole: mostly green candles with net upward move. At least 70% must be green. */
  private isValidPole(candles: Candle[]): boolean {
    if (candles.length < this.MIN_POLE) return false;
    const greenCount = candles.filter((c) => c.c > c.o).length;
    if (greenCount / candles.length < 0.7) return false;
    return candles[candles.length - 1].c > candles[0].o;
  }

  /** Flag: consolidation — at least half candles red or small-bodied (doji). */
  private isValidFlag(flagCandles: Candle[]): boolean {
    if (flagCandles.length < this.MIN_FLAG) return false;
    const redOrDoji = flagCandles.filter((c) => {
      const body = Math.abs(c.c - c.o);
      const range = c.h - c.l;
      return c.c <= c.o || (range > 0 && body / range < 0.3);
    }).length;
    return redOrDoji >= flagCandles.length * 0.5;
  }
}
