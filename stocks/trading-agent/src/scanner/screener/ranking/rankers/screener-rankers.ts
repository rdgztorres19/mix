/**
 * Pure ranking from Alpaca-style snapshots (+ optional prev close overlay).
 * Aligned with stocks/stock-training/scripts/download-gainers.ts where noted.
 */

import type { SnapshotsResponse, SnapshotItem } from '../../alpaca/alpaca-screener.client';
import type { ScreenerRankRow, ScreenerRankType } from '../../persistence/screener.repository';

function getDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function prevCloseForItem(
  symbol: string,
  item: SnapshotItem,
  prevCloseBySymbol: ReadonlyMap<string, number>,
): number | null {
  const fromDb = prevCloseBySymbol.get(symbol.toUpperCase());
  // Prefer DB prev_close because it is filled via daily bars (with split adjustment)
  // and avoids relying on snapshot prevDailyBar semantics.
  if (fromDb != null && Number.isFinite(fromDb) && fromDb > 0) return fromDb;

  const fromBar = item.prevDailyBar?.c;
  return fromBar != null && Number.isFinite(fromBar) && fromBar > 0 ? fromBar : null;
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

// ═══════════════════════════════════════════════════════════════════════════
// Generic ranking engine — each exported function only provides a metric fn
// ═══════════════════════════════════════════════════════════════════════════

interface MetricResult {
  metric: number;
  /** Override close/high in extras when the effective price differs from dailyBar */
  closeOverride?: number;
  highOverride?: number;
}

type MetricFn = (
  dailyBar: { o: number; h: number; l: number; c: number; v: number },
  prev: number,
  item: SnapshotItem,
) => MetricResult | null;

function rankByMetric(
  snapshots: SnapshotsResponse,
  prevCloseBySymbol: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
  rankType: ScreenerRankType,
  metricFn: MetricFn,
): ScreenerRankRow[] {
  const acc: { symbol: string; metric: number; volume: number; extras: Partial<ScreenerRankRow> }[] = [];

  for (const [symbol, item] of Object.entries(snapshots)) {
    const dailyBar = item?.dailyBar;
    if (!dailyBar) continue;
    const v = dailyBar.v ?? 0;
    if (!Number.isFinite(v) || v < minVolume) continue;
    if (!Number.isFinite(dailyBar.c) || dailyBar.c <= 1) continue;
    const prev = prevCloseForItem(symbol, item, prevCloseBySymbol);
    if (prev == null) continue;

    const result = metricFn(dailyBar, prev, item);
    if (result == null || !Number.isFinite(result.metric)) continue;

    acc.push({
      symbol,
      metric: result.metric,
      volume: v,
      extras: {
        open: dailyBar.o,
        high: result.highOverride ?? dailyBar.h,
        low: dailyBar.l,
        close: result.closeOverride ?? dailyBar.c,
        previous_close: prev,
        volume: v,
      },
    });
  }

  return sortByMetricThenVolume(acc, topN, rankType);
}

// ═══════════════════════════════════════════════════════════════════════════
// Exported rankers
// ═══════════════════════════════════════════════════════════════════════════

/** Gap from prev close to today's open: (dailyBar.o - prev) / prev * 100 */
export function rankTopGappers(
  snapshots: SnapshotsResponse,
  _sessionDate: string,
  prevCloseBySymbol: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  return rankByMetric(snapshots, prevCloseBySymbol, topN, minVolume, 'gapper', (bar, prev) => {
    if (!Number.isFinite(bar.o) || bar.o <= 0) return null;
    return { metric: ((bar.o - prev) / prev) * 100 };
  });
}

/** Session / "historical of day" from snapshot daily close vs prev daily bar close. */
export function rankTopGainersSession(
  snapshots: SnapshotsResponse,
  _sessionDate: string,
  prevCloseBySymbol: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  return rankByMetric(snapshots, prevCloseBySymbol, topN, minVolume, 'gainer_session', (bar, prev) => {
    return { metric: ((bar.c - prev) / prev) * 100 };
  });
}

/** Intraday: % from prev close to latest trade price when present, else dailyBar.c */
export function rankTopGainersIntraday(
  snapshots: SnapshotsResponse,
  _sessionDate: string,
  prevCloseBySymbol: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  return rankByMetric(snapshots, prevCloseBySymbol, topN, minVolume, 'gainer_intraday', (bar, prev, item) => {
    const last = item.latestTrade?.p ?? bar.c;
    if (!Number.isFinite(last) || last <= 0) return null;
    return { metric: ((last - prev) / prev) * 100, closeOverride: last };
  });
}

/** High of day (dailyBar.h) vs prev close */
export function rankTopHighSession(
  snapshots: SnapshotsResponse,
  _sessionDate: string,
  prevCloseBySymbol: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  return rankByMetric(snapshots, prevCloseBySymbol, topN, minVolume, 'high_session', (bar, prev) => {
    if (!Number.isFinite(bar.h) || bar.h <= 0) return null;
    return { metric: ((bar.h - prev) / prev) * 100 };
  });
}

/** "Current" high extension: max(dailyBar.h, latestTrade.p) vs prev */
export function rankTopHighCurrent(
  snapshots: SnapshotsResponse,
  _sessionDate: string,
  prevCloseBySymbol: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  return rankByMetric(snapshots, prevCloseBySymbol, topN, minVolume, 'high_current', (bar, prev, item) => {
    if (!Number.isFinite(bar.h) || bar.h <= 0) return null;
    const lt = item.latestTrade?.p;
    const effectiveHigh = lt != null && Number.isFinite(lt) ? Math.max(bar.h, lt) : bar.h;
    return { metric: ((effectiveHigh - prev) / prev) * 100, highOverride: effectiveHigh };
  });
}

export function barsPrevCloseBeforeSession(
  bars: import('../../alpaca/alpaca-screener.client').AlpacaBar[],
  sessionDate: string,
): number | null {
  if (!bars?.length) return null;
  const before = bars.filter((b) => getDateOnly(b.t) < sessionDate);
  if (!before.length) return null;
  const last = before[before.length - 1];
  const c = last.c;
  return Number.isFinite(c) && c > 0 ? c : null;
}
