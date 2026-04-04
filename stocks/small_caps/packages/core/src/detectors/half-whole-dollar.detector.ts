import type { Candle, PatternResult } from '@small-caps/shared';

export class HalfWholeDollarDetector {
  private readonly PROXIMITY_THRESHOLD = 0.05; // $0.05
  private readonly LOOKBACK = 3;

  detect(candles: Candle[]): PatternResult {
    const empty: PatternResult = { detected: false, name: 'HALF_WHOLE_DOLLAR', anchor_points: [], description: '' };
    if (candles.length < this.LOOKBACK + 1) return empty;

    const current = candles[candles.length - 1];
    const price = current.c;
    if (price <= 0) return empty;

    // Find nearest half/whole dollar level above current price
    const nearestAbove = Math.ceil(price * 2) / 2;

    // If price is exactly on the level, it's not "approaching"
    const distance = nearestAbove - price;
    if (distance <= 0 || distance > this.PROXIMITY_THRESHOLD) return empty;

    // Previous N candles must have been below that level
    const lookback = candles.slice(-(this.LOOKBACK + 1), -1);
    const allBelow = lookback.every((c) => c.h < nearestAbove);
    if (!allBelow) return empty;

    // Confirm approach from below: price should be trending up into the level
    const approachUp = price > lookback[lookback.length - 1].c;
    if (!approachUp) return empty;

    const isWhole = nearestAbove % 1 === 0;
    const levelType = isWhole ? 'whole dollar' : 'half dollar';

    return {
      detected: true,
      name: 'HALF_WHOLE_DOLLAR',
      anchor_points: [
        { label: 'Level', price: nearestAbove, time: current.t },
        { label: 'CurrentPrice', price: price, time: current.t },
      ],
      description: `Approaching ${levelType} $${nearestAbove.toFixed(2)} from below ($${distance.toFixed(3)} away)`,
    };
  }
}
