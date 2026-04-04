import type { Candle, SRLevel } from '@small-caps/shared';
import { SmaCalculator } from '../indicators/sma.calculator';
import { VwapCalculator } from '../indicators/vwap.calculator';

export interface SRContext {
  candles: Candle[];
  prevDayClose?: number;
  yesterdayHigh?: number;
  yesterdayLow?: number;
  twoDaysAgoHigh?: number;
  twoDaysAgoLow?: number;
  preMarketHigh?: number;
  preMarketLow?: number;
}

/**
 * Detects support/resistance levels from:
 * - Previous day close
 * - Yesterday high/low
 * - 2 days ago high/low
 * - Pre-market high/low
 * - VWAP (dynamic)
 * - 50 SMA, 200 SMA (dynamic)
 */
export class SupportResistanceDetector {
  detect(ctx: SRContext): SRLevel[] {
    const levels: SRLevel[] = [];
    const currentPrice = ctx.candles.length > 0 ? ctx.candles[ctx.candles.length - 1].c : 0;

    // Predetermined levels
    if (ctx.prevDayClose != null) {
      levels.push({
        label: 'Prev Close',
        price: ctx.prevDayClose,
        type: currentPrice > ctx.prevDayClose ? 'support' : 'resistance',
      });
    }

    if (ctx.yesterdayHigh != null) {
      levels.push({ label: 'Yesterday High', price: ctx.yesterdayHigh, type: 'resistance' });
    }
    if (ctx.yesterdayLow != null) {
      levels.push({ label: 'Yesterday Low', price: ctx.yesterdayLow, type: 'support' });
    }

    if (ctx.twoDaysAgoHigh != null) {
      levels.push({ label: '2D Ago High', price: ctx.twoDaysAgoHigh, type: 'resistance' });
    }
    if (ctx.twoDaysAgoLow != null) {
      levels.push({ label: '2D Ago Low', price: ctx.twoDaysAgoLow, type: 'support' });
    }

    if (ctx.preMarketHigh != null) {
      levels.push({ label: 'PM High', price: ctx.preMarketHigh, type: 'resistance' });
    }
    if (ctx.preMarketLow != null) {
      levels.push({ label: 'PM Low', price: ctx.preMarketLow, type: 'support' });
    }

    // Dynamic levels
    if (ctx.candles.length > 0) {
      const vwap = VwapCalculator.calculate(ctx.candles);
      if (vwap != null) {
        levels.push({ label: 'VWAP', price: vwap, type: 'dynamic' });
      }

      const closes = ctx.candles.map((c) => c.c);
      const sma50 = SmaCalculator.calculate(closes, 50);
      if (sma50 != null) {
        levels.push({ label: '50 SMA', price: sma50, type: 'dynamic' });
      }

      const sma200 = SmaCalculator.calculate(closes, 200);
      if (sma200 != null) {
        levels.push({ label: '200 SMA', price: sma200, type: 'dynamic' });
      }
    }

    return levels;
  }
}
