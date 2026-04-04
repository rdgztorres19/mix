/**
 * Pure ranking functions for the screener.
 * Ported from trading-agent/src/scanner/screener/ranking/rankers/screener-rankers.ts
 * Adapted to work with our own data structures (candle_1m from MySQL).
 */
import type { ScreenerRankRow, ScreenerRankType } from '@small-caps/shared';

/** A synthetic daily snapshot built from 1m candles. */
export interface DailySnapshot {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function sortByMetricThenVolume(
  rows: { symbol: string; metric: number; volume: number; extras: Partial<ScreenerRankRow> }[],
  topN: number,
  rankType: ScreenerRankType,
): ScreenerRankRow[] {
  return rows
    .sort((a, b) => {
      if (b.metric !== a.metric) return b.metric - a.metric;
      return (b.volume || 0) - (a.volume || 0);
    })
    .slice(0, topN)
    .map((r, idx) => ({
      rank_type: rankType,
      rank_order: idx + 1,
      symbol: r.symbol,
      metric_value: r.metric,
      ...r.extras,
    }));
}

type MetricFn = (snap: DailySnapshot, prevClose: number) => number | null;

function rankByMetric(
  snapshots: DailySnapshot[],
  prevCloseMap: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
  rankType: ScreenerRankType,
  metricFn: MetricFn,
): ScreenerRankRow[] {
  const acc: { symbol: string; metric: number; volume: number; extras: Partial<ScreenerRankRow> }[] = [];

  for (const snap of snapshots) {
    if (snap.volume < minVolume) continue;
    if (snap.close <= 1) continue;
    const prev = prevCloseMap.get(snap.symbol.toUpperCase());
    if (prev == null || prev <= 0) continue;

    const metric = metricFn(snap, prev);
    if (metric == null || !Number.isFinite(metric)) continue;

    acc.push({
      symbol: snap.symbol,
      metric,
      volume: snap.volume,
      extras: {
        open: snap.open,
        high: snap.high,
        low: snap.low,
        close: snap.close,
        previous_close: prev,
        volume: snap.volume,
      },
    });
  }

  return sortByMetricThenVolume(acc, topN, rankType);
}

/** Gap from prev close to today's open. */
export function rankTopGappers(
  snapshots: DailySnapshot[],
  prevCloseMap: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  return rankByMetric(snapshots, prevCloseMap, topN, minVolume, 'gapper', (snap, prev) => {
    if (snap.open <= 0) return null;
    return ((snap.open - prev) / prev) * 100;
  });
}

/** Session close vs prev close. */
export function rankTopGainersSession(
  snapshots: DailySnapshot[],
  prevCloseMap: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  return rankByMetric(snapshots, prevCloseMap, topN, minVolume, 'gainer_session', (snap, prev) => {
    return ((snap.close - prev) / prev) * 100;
  });
}

/** Intraday: close vs prev close (same as session for EOD). */
export function rankTopGainersIntraday(
  snapshots: DailySnapshot[],
  prevCloseMap: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  return rankByMetric(snapshots, prevCloseMap, topN, minVolume, 'gainer_intraday', (snap, prev) => {
    return ((snap.close - prev) / prev) * 100;
  });
}

/** High of day vs prev close. */
export function rankTopHighSession(
  snapshots: DailySnapshot[],
  prevCloseMap: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  return rankByMetric(snapshots, prevCloseMap, topN, minVolume, 'high_session', (snap, prev) => {
    if (snap.high <= 0) return null;
    return ((snap.high - prev) / prev) * 100;
  });
}

/** Current high extension: max(high, close) vs prev. */
export function rankTopHighCurrent(
  snapshots: DailySnapshot[],
  prevCloseMap: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  return rankByMetric(snapshots, prevCloseMap, topN, minVolume, 'high_current', (snap, prev) => {
    const effectiveHigh = Math.max(snap.high, snap.close);
    return ((effectiveHigh - prev) / prev) * 100;
  });
}
