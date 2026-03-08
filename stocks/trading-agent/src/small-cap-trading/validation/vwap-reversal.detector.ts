import type { Candle, PatternResult } from '../types';

/**
 * VWAP Reversal detector — detects when a stock below VWAP fails to make
 * new 5-min lows (sellers exhausted) or forms Higher Highs + Higher Lows,
 * signaling potential squeeze back toward VWAP.
 */
export class VwapReversalDetector {
  private readonly MIN_CANDLES = 3;

  detect(candles: Candle[], vwap: number | null): PatternResult {
    const empty: PatternResult = { detected: false, name: 'VWAP_REVERSAL', anchor_points: [], description: '' };
    if (!vwap || candles.length < this.MIN_CANDLES) return empty;

    const lastPrice = candles[candles.length - 1].c;
    const belowVwap = lastPrice < vwap;
    const aboveVwap = lastPrice > vwap;

    if (belowVwap) return this.detectBullishReversal(candles, vwap);
    if (aboveVwap) return this.detectBearishReversal(candles, vwap);

    return empty;
  }

  /** Below VWAP: failure to make new low + HH/HL pattern = bullish reversal. */
  private detectBullishReversal(candles: Candle[], vwap: number): PatternResult {
    const recent = candles.slice(-5);
    if (recent.length < 3) {
      return { detected: false, name: 'VWAP_REVERSAL', anchor_points: [], description: '' };
    }

    // Check: last candle's low is NOT a new low (failure to continue down)
    const priorLow = Math.min(...recent.slice(0, -1).map((c) => c.l));
    const lastLow = recent[recent.length - 1].l;
    const failedNewLow = lastLow > priorLow;

    if (!failedNewLow) {
      return { detected: false, name: 'VWAP_REVERSAL', anchor_points: [], description: '' };
    }

    // Check for Higher Highs and Higher Lows (at least 2 consecutive)
    let hhCount = 0;
    let hlCount = 0;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i].h > recent[i - 1].h) hhCount++;
      if (recent[i].l > recent[i - 1].l) hlCount++;
    }
    const hhhl = hhCount >= 2 && hlCount >= 2;

    // Signal: failed new low below VWAP
    const pivotCandle = recent.reduce((min, c) => (c.l < min.l ? c : min), recent[0]);
    return {
      detected: true,
      name: 'VWAP_REVERSAL',
      anchor_points: [
        { label: 'ReversalLow', price: pivotCandle.l, time: pivotCandle.t },
        { label: 'VWAP', price: vwap, time: recent[recent.length - 1].t },
        { label: 'CurrentPrice', price: recent[recent.length - 1].c, time: recent[recent.length - 1].t },
      ],
      description: `Bullish VWAP reversal: failed new low at $${pivotCandle.l.toFixed(2)}${hhhl ? ', HH/HL forming' : ''}, squeezing toward VWAP $${vwap.toFixed(2)}`,
    };
  }

  /** Above VWAP: failure to make new high = bearish reversal. */
  private detectBearishReversal(candles: Candle[], vwap: number): PatternResult {
    const recent = candles.slice(-5);
    if (recent.length < 3) {
      return { detected: false, name: 'VWAP_REVERSAL', anchor_points: [], description: '' };
    }

    const priorHigh = Math.max(...recent.slice(0, -1).map((c) => c.h));
    const lastHigh = recent[recent.length - 1].h;
    const failedNewHigh = lastHigh < priorHigh;

    if (!failedNewHigh) {
      return { detected: false, name: 'VWAP_REVERSAL', anchor_points: [], description: '' };
    }

    const pivotCandle = recent.reduce((max, c) => (c.h > max.h ? c : max), recent[0]);
    return {
      detected: true,
      name: 'VWAP_REVERSAL',
      anchor_points: [
        { label: 'ReversalHigh', price: pivotCandle.h, time: pivotCandle.t },
        { label: 'VWAP', price: vwap, time: recent[recent.length - 1].t },
        { label: 'CurrentPrice', price: recent[recent.length - 1].c, time: recent[recent.length - 1].t },
      ],
      description: `Bearish VWAP reversal: failed new high at $${pivotCandle.h.toFixed(2)}, dropping toward VWAP $${vwap.toFixed(2)}`,
    };
  }
}
