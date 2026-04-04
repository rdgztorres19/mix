/**
 * EOD Screener: combines 5 ranking types into a merged list.
 * Ported from backtest-simulator/screener.ts computeCombinedListWide().
 */
import type { ScreenerRankRow, ScreenerRankType, ScreenerSymbol } from '@small-caps/shared';
import { SCREENER_TOP_N, SCREENER_MIN_VOLUME, SCREENER_WIDE_LIMIT } from '@small-caps/shared';
import {
  rankTopGappers,
  rankTopGainersSession,
  rankTopGainersIntraday,
  rankTopHighSession,
  rankTopHighCurrent,
  type DailySnapshot,
} from './rankers';

export interface ScreenerInput {
  snapshots: DailySnapshot[];
  prevCloseMap: ReadonlyMap<string, number>;
  topN?: number;
  minVolume?: number;
  wideLimit?: number;
}

export interface ScreenerOutput {
  symbols: ScreenerSymbol[];
  ranksByType: Record<ScreenerRankType, ScreenerRankRow[]>;
}

/**
 * Run full screener: compute 5 ranking types, merge, deduplicate, return top N.
 */
export function computeScreener(input: ScreenerInput): ScreenerOutput {
  const topN = input.topN ?? SCREENER_TOP_N;
  const minVolume = input.minVolume ?? SCREENER_MIN_VOLUME;
  const wideLimit = input.wideLimit ?? SCREENER_WIDE_LIMIT;

  const gappers = rankTopGappers(input.snapshots, input.prevCloseMap, topN, minVolume);
  const gainersSession = rankTopGainersSession(input.snapshots, input.prevCloseMap, topN, minVolume);
  const gainersIntraday = rankTopGainersIntraday(input.snapshots, input.prevCloseMap, topN, minVolume);
  const highSession = rankTopHighSession(input.snapshots, input.prevCloseMap, topN, minVolume);
  const highCurrent = rankTopHighCurrent(input.snapshots, input.prevCloseMap, topN, minVolume);

  const ranksByType: Record<ScreenerRankType, ScreenerRankRow[]> = {
    gapper: gappers,
    gainer_session: gainersSession,
    gainer_intraday: gainersIntraday,
    high_session: highSession,
    high_current: highCurrent,
  };

  // Merge and deduplicate
  const symbolMap = new Map<string, {
    bestRank: number;
    rankTypes: Set<ScreenerRankType>;
    row: ScreenerRankRow;
  }>();

  const allRanks = [...gappers, ...gainersSession, ...gainersIntraday, ...highSession, ...highCurrent];
  for (const row of allRanks) {
    const existing = symbolMap.get(row.symbol);
    if (existing) {
      existing.rankTypes.add(row.rank_type);
      if (row.rank_order < existing.bestRank) {
        existing.bestRank = row.rank_order;
        existing.row = row;
      }
    } else {
      symbolMap.set(row.symbol, {
        bestRank: row.rank_order,
        rankTypes: new Set([row.rank_type]),
        row,
      });
    }
  }

  // Sort by number of appearances (desc), then by best rank (asc)
  const sorted = [...symbolMap.entries()]
    .sort((a, b) => {
      const countDiff = b[1].rankTypes.size - a[1].rankTypes.size;
      if (countDiff !== 0) return countDiff;
      return a[1].bestRank - b[1].bestRank;
    })
    .slice(0, wideLimit);

  const symbols: ScreenerSymbol[] = sorted.map(([symbol, data], idx) => {
    const prev = data.row.previous_close ?? 0;
    const open = data.row.open ?? 0;
    const close = data.row.close ?? 0;
    return {
      symbol,
      rank: idx + 1,
      gapPct: prev > 0 ? ((open - prev) / prev) * 100 : 0,
      changePct: prev > 0 ? ((close - prev) / prev) * 100 : 0,
      volume: data.row.volume ?? 0,
      rankTypes: [...data.rankTypes],
      previousClose: prev,
      open,
      close,
      high: data.row.high ?? 0,
      low: data.row.low ?? 0,
    };
  });

  return { symbols, ranksByType };
}
