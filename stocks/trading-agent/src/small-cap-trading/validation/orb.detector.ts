import type { Candle, PatternResult } from '../types';

/**
 * Opening Range Breakout detector — identifies the range of the first 5-min candle
 * after 9:30 AM ET and checks if price has broken out.
 * Range must be smaller than ATR to qualify (tight opening = better breakout).
 */
export class OrbDetector {
  detect(candles: Candle[], atr: number): PatternResult {
    const empty: PatternResult = { detected: false, name: 'ORB', anchor_points: [], description: '' };
    if (candles.length < 2) return empty;

    // Find the first candle in the 9:30-9:35 window (first 5-min candle)
    const firstCandle = this.findOpeningCandle(candles);
    if (!firstCandle) return empty;

    const rangeHigh = firstCandle.h;
    const rangeLow = firstCandle.l;
    const openingRange = rangeHigh - rangeLow;

    // Opening range must be significantly smaller than ATR
    if (openingRange >= atr * 0.6) return empty;

    // Check if price has broken out of the range
    const lastCandle = candles[candles.length - 1];
    const breakoutUp = lastCandle.c > rangeHigh;
    const breakoutDown = lastCandle.c < rangeLow;

    if (!breakoutUp && !breakoutDown) {
      // Range is defined but no breakout yet — still report the range for drawing
      return {
        detected: true,
        name: 'ORB',
        anchor_points: [
          { label: 'ORB_High', price: rangeHigh, time: firstCandle.t },
          { label: 'ORB_Low', price: rangeLow, time: firstCandle.t },
        ],
        description: `ORB range: $${rangeLow.toFixed(2)}–$${rangeHigh.toFixed(2)} (${openingRange.toFixed(2)} range vs ${atr.toFixed(2)} ATR). No breakout yet.`,
      };
    }

    const direction = breakoutUp ? 'LONG' : 'SHORT';
    return {
      detected: true,
      name: 'ORB',
      anchor_points: [
        { label: 'ORB_High', price: rangeHigh, time: firstCandle.t },
        { label: 'ORB_Low', price: rangeLow, time: firstCandle.t },
        { label: `Breakout_${direction}`, price: lastCandle.c, time: lastCandle.t },
      ],
      description: `ORB ${direction} breakout: range $${rangeLow.toFixed(2)}–$${rangeHigh.toFixed(2)} (${openingRange.toFixed(2)} vs ATR ${atr.toFixed(2)})`,
    };
  }

  /** Find the first candle that falls in the 9:30–9:35 ET window. */
  private findOpeningCandle(candles: Candle[]): Candle | null {
    for (const c of candles) {
      const d = new Date(c.t);
      const etStr = d.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric', minute: 'numeric', hour12: false,
      });
      const [h, m] = etStr.split(':').map(Number);
      const totalMin = h * 60 + m;
      // First candle in 9:30–9:34 range (5-min candle starting at open)
      if (totalMin >= 570 && totalMin <= 574) return c;
    }
    return null;
  }
}
