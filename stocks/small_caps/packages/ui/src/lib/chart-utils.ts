import type { Candle, IndicatorValues } from '@/api/backend';

/**
 * Convert UTC timestamp (ms) to a "fake UTC" that displays as ET in lightweight-charts.
 * lightweight-charts has no timezone support — it renders timestamps as UTC.
 * So we shift the timestamp by the ET offset to make it display correctly.
 */
export function utcToET(utcMs: number): number {
  // Get ET hours/minutes directly via Intl, build a "fake UTC" timestamp
  const d = new Date(utcMs);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  // Build a Date as if this ET time were UTC — lightweight-charts will display it as-is
  const fakeUtc = Date.UTC(
    parseInt(get('year')), parseInt(get('month')) - 1, parseInt(get('day')),
    parseInt(get('hour')), parseInt(get('minute')), parseInt(get('second')),
  );
  return Math.floor(fakeUtc / 1000);
}

/** Deduplicate, sort, and convert to ET timestamps for lightweight-charts. */
export function prepareChartData(candles: Candle[], indicators: IndicatorValues[]) {
  const seen = new Map<number, number>();
  const sorted = candles
    .map((c, i) => ({ c, ind: indicators[i], ts: utcToET(c.t) }))
    .sort((a, b) => a.ts - b.ts);
  const result: typeof sorted = [];
  for (const item of sorted) {
    if (!seen.has(item.ts)) {
      seen.set(item.ts, result.length);
      result.push(item);
    }
  }
  return result;
}

/** Compute moving average of volume. */
export function computeVolumeMA(volumes: number[], period = 20): (number | null)[] {
  return volumes.map((_, i) => {
    if (i + 1 < period) return null;
    const slice = volumes.slice(i + 1 - period, i + 1);
    return slice.reduce((s, v) => s + v, 0) / period;
  });
}
