import type { Candle, PatternResult } from '@small-caps/shared';

export class HodBreakDetector {
  private readonly NEAR_HOD_PCT = 0.01; // within 1% of HOD

  detect(candles: Candle[], highOfDay: number): PatternResult {
    const empty: PatternResult = { detected: false, name: 'HOD_BREAK', anchor_points: [], description: '' };
    if (candles.length < 2) return empty;
    if (highOfDay <= 0) return empty;

    const current = candles[candles.length - 1];
    const price = current.c;

    // Compute running HOD from all candles
    const runningHod = Math.max(...candles.map((c) => c.h));

    // Use the greater of passed highOfDay and running HOD (HOD might include premarket)
    const effectiveHod = Math.max(highOfDay, runningHod);

    // Previous candle HOD (excluding current) to detect a fresh break
    const prevCandles = candles.slice(0, -1);
    const prevHod = Math.max(...prevCandles.map((c) => c.h));

    // Scenario 1: Breaking through HOD (current high exceeds previous HOD)
    const breakingThrough = current.h > prevHod && current.c > prevHod;

    // Scenario 2: Price within 1% below HOD (approaching)
    const distancePct = (effectiveHod - price) / effectiveHod;
    const nearHod = distancePct >= 0 && distancePct <= this.NEAR_HOD_PCT;

    if (!breakingThrough && !nearHod) return empty;

    // Require upward momentum: current close > previous close
    const prev = candles[candles.length - 2];
    if (price <= prev.c) return empty;

    const status = breakingThrough ? 'BREAKING' : 'APPROACHING';
    const distStr = distancePct > 0 ? `${(distancePct * 100).toFixed(2)}% below` : 'at';

    return {
      detected: true,
      name: 'HOD_BREAK',
      anchor_points: [
        { label: 'HOD', price: effectiveHod, time: current.t },
        { label: 'CurrentPrice', price: price, time: current.t },
      ],
      description: `HOD ${status}: price $${price.toFixed(2)} ${distStr} HOD $${effectiveHod.toFixed(2)}`,
    };
  }
}
