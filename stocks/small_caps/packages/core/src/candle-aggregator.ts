import type { Candle } from '@small-caps/shared';

/**
 * Aggregate 1-minute candles into N-minute candles.
 * Groups by blocks of `interval` minutes based on timestamp.
 */
export function aggregateCandles(candles: Candle[], intervalMinutes: number): Candle[] {
  if (!candles.length || intervalMinutes <= 1) return candles;

  const groups = new Map<number, Candle[]>();
  for (const c of candles) {
    // Group key: floor to interval boundary
    const bucket = Math.floor(c.t / (intervalMinutes * 60_000)) * (intervalMinutes * 60_000);
    const group = groups.get(bucket);
    if (group) {
      group.push(c);
    } else {
      groups.set(bucket, [c]);
    }
  }

  const result: Candle[] = [];
  const sortedKeys = [...groups.keys()].sort((a, b) => a - b);

  for (const key of sortedKeys) {
    const group = groups.get(key)!;
    result.push({
      t: key,
      o: group[0].o,
      h: Math.max(...group.map((c) => c.h)),
      l: Math.min(...group.map((c) => c.l)),
      c: group[group.length - 1].c,
      v: group.reduce((sum, c) => sum + c.v, 0),
    });
  }

  return result;
}

/** Convenience: aggregate 1m to 5m. */
export function aggregate1mTo5m(candles: Candle[]): Candle[] {
  return aggregateCandles(candles, 5);
}
