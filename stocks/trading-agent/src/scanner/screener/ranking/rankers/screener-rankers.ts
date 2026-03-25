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

/** Gap from prev close to today's open: (dailyBar.o - prev) / prev * 100 */
export function rankTopGappers(
  snapshots: SnapshotsResponse,
  _sessionDate: string,
  prevCloseBySymbol: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  const acc: { symbol: string; metric: number; volume: number; extras: Partial<ScreenerRankRow> }[] = [];

  for (const [symbol, item] of Object.entries(snapshots)) {
    if (symbol === 'ONCO') {
      console.log('item', item);
    }
    const dailyBar = item?.dailyBar;
    if (!dailyBar) continue;
    const v = dailyBar.v ?? 0;
    if (!Number.isFinite(v) || v < minVolume) continue;
    const prev = prevCloseForItem(symbol, item, prevCloseBySymbol);
    if (prev == null || !Number.isFinite(dailyBar.o) || dailyBar.o <= 0) continue;
    const gapPct = ((dailyBar.o - prev) / prev) * 100;
    if (!Number.isFinite(gapPct)) continue;
    acc.push({
      symbol,
      metric: gapPct,
      volume: v,
      extras: {
        open: dailyBar.o,
        high: dailyBar.h,
        low: dailyBar.l,
        close: dailyBar.c,
        previous_close: prev,
        volume: v,
      },
    });
  }

  return sortByMetricThenVolume(acc, topN, 'gapper');
}

/** Session / "historical of day" from snapshot daily close vs prev daily bar close. */
export function rankTopGainersSession(
  snapshots: SnapshotsResponse,
  _sessionDate: string,
  prevCloseBySymbol: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  const acc: { symbol: string; metric: number; volume: number; extras: Partial<ScreenerRankRow> }[] = [];

  for (const [symbol, item] of Object.entries(snapshots)) {
    const dailyBar = item?.dailyBar;
    if (!dailyBar) continue;
    const v = dailyBar.v ?? 0;
    if (!Number.isFinite(v) || v < minVolume) continue;
    const prev = prevCloseForItem(symbol, item, prevCloseBySymbol);
    if (prev == null || !Number.isFinite(dailyBar.c) || dailyBar.c <= 0) continue;
    const pct = ((dailyBar.c - prev) / prev) * 100;
    if (!Number.isFinite(pct)) continue;
    acc.push({
      symbol,
      metric: pct,
      volume: v,
      extras: {
        open: dailyBar.o,
        high: dailyBar.h,
        low: dailyBar.l,
        close: dailyBar.c,
        previous_close: prev,
        volume: v,
      },
    });
  }

  return sortByMetricThenVolume(acc, topN, 'gainer_session');
}

/**
 * Intraday: % from prev close to latest trade price when present, else dailyBar.c
 * (see plan: último precio de sesión).
 */
export function rankTopGainersIntraday(
  snapshots: SnapshotsResponse,
  _sessionDate: string,
  prevCloseBySymbol: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  const acc: { symbol: string; metric: number; volume: number; extras: Partial<ScreenerRankRow> }[] = [];

  for (const [symbol, item] of Object.entries(snapshots)) {
    const dailyBar = item?.dailyBar;
    if (!dailyBar) continue;
    const v = dailyBar.v ?? 0;
    if (!Number.isFinite(v) || v < minVolume) continue;
    const prev = prevCloseForItem(symbol, item, prevCloseBySymbol);
    if (prev == null) continue;
    const last = item.latestTrade?.p ?? dailyBar.c;
    if (!Number.isFinite(last) || last <= 0) continue;
    const pct = ((last - prev) / prev) * 100;
    if (!Number.isFinite(pct)) continue;
    acc.push({
      symbol,
      metric: pct,
      volume: v,
      extras: {
        open: dailyBar.o,
        high: dailyBar.h,
        low: dailyBar.l,
        close: last,
        previous_close: prev,
        volume: v,
      },
    });
  }

  return sortByMetricThenVolume(acc, topN, 'gainer_intraday');
}

/** High of day (dailyBar.h) vs prev close — same as buildTodayTopHighOfDayFromSnapshots. */
export function rankTopHighSession(
  snapshots: SnapshotsResponse,
  _sessionDate: string,
  prevCloseBySymbol: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  const acc: { symbol: string; metric: number; volume: number; extras: Partial<ScreenerRankRow> }[] = [];

  for (const [symbol, item] of Object.entries(snapshots)) {
    const dailyBar = item?.dailyBar;
    if (!dailyBar) continue;
    const v = dailyBar.v ?? 0;
    if (!Number.isFinite(v) || v < minVolume) continue;
    const prev = prevCloseForItem(symbol, item, prevCloseBySymbol);
    if (prev == null || !Number.isFinite(dailyBar.h) || dailyBar.h <= 0) continue;
    const pct = ((dailyBar.h - prev) / prev) * 100;
    if (!Number.isFinite(pct)) continue;
    acc.push({
      symbol,
      metric: pct,
      volume: v,
      extras: {
        open: dailyBar.o,
        high: dailyBar.h,
        low: dailyBar.l,
        close: dailyBar.c,
        previous_close: prev,
        volume: v,
      },
    });
  }

  return sortByMetricThenVolume(acc, topN, 'high_session');
}

/**
 * "Current" high extension: max(dailyBar.h, latestTrade.p) vs prev when last sale exists;
 * otherwise same as session (plan default without 1Min bars).
 */
export function rankTopHighCurrent(
  snapshots: SnapshotsResponse,
  _sessionDate: string,
  prevCloseBySymbol: ReadonlyMap<string, number>,
  topN: number,
  minVolume: number,
): ScreenerRankRow[] {
  const acc: { symbol: string; metric: number; volume: number; extras: Partial<ScreenerRankRow> }[] = [];

  for (const [symbol, item] of Object.entries(snapshots)) {
    const dailyBar = item?.dailyBar;
    if (!dailyBar) continue;
    const v = dailyBar.v ?? 0;
    if (!Number.isFinite(v) || v < minVolume) continue;
    const prev = prevCloseForItem(symbol, item, prevCloseBySymbol);
    if (prev == null || !Number.isFinite(dailyBar.h) || dailyBar.h <= 0) continue;
    const lt = item.latestTrade?.p;
    const effectiveHigh =
      lt != null && Number.isFinite(lt) ? Math.max(dailyBar.h, lt) : dailyBar.h;
    const pct = ((effectiveHigh - prev) / prev) * 100;
    if (!Number.isFinite(pct)) continue;
    acc.push({
      symbol,
      metric: pct,
      volume: v,
      extras: {
        open: dailyBar.o,
        high: effectiveHigh,
        low: dailyBar.l,
        close: dailyBar.c,
        previous_close: prev,
        volume: v,
      },
    });
  }

  return sortByMetricThenVolume(acc, topN, 'high_current');
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
