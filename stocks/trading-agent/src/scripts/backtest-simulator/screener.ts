import type { CollectorCandle } from '../../collector/indicator.calculator';
import type {
  SnapshotsResponse,
  SnapshotItem,
  AlpacaBar,
} from '../../scanner/screener/alpaca/alpaca-screener.client';
import type { ScreenerRankRow, ScreenerRankType } from '../../scanner/screener/persistence/screener.repository';
import {
  rankTopGappers,
  rankTopGainersSession,
  rankTopGainersIntraday,
  rankTopHighSession,
  rankTopHighCurrent,
} from '../../scanner/screener/ranking/rankers/screener-rankers';

export interface CombinedResult {
  symbols: string[];
  /** For each symbol, which ranking categories placed it in the top N */
  reasons: Map<string, Set<ScreenerRankType>>;
}

export class BacktestScreener {
  private cachedGapperRanks: ScreenerRankRow[] | null = null;
  private readonly topN: number;
  private readonly minVolume: number;

  constructor(topN = 40, minVolume = 0) {
    this.topN = topN;
    this.minVolume = minVolume;
  }

  buildSnapshotsFromDailyBars(
    dailyBars: Map<string, AlpacaBar[]>,
    prevCloseMap: ReadonlyMap<string, number>,
  ): SnapshotsResponse {
    const snapshots: SnapshotsResponse = {};

    for (const [symbol, bars] of dailyBars) {
      if (!bars.length) continue;
      const bar = bars[bars.length - 1];
      const prevClose = prevCloseMap.get(symbol.toUpperCase());

      const item: SnapshotItem = {
        dailyBar: { t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v },
        latestTrade: { p: bar.c },
      };
      if (prevClose != null) {
        item.prevDailyBar = { t: '', o: 0, h: 0, l: 0, c: prevClose, v: 0 };
      }
      snapshots[symbol.toUpperCase()] = item;
    }

    return snapshots;
  }

  buildSyntheticSnapshots(
    candlesBySymbol: Map<string, CollectorCandle[]>,
    currentTimeMs: number,
    prevCloseMap: ReadonlyMap<string, number>,
    dailySnapshots: SnapshotsResponse,
  ): SnapshotsResponse {
    const snapshots: SnapshotsResponse = { ...dailySnapshots };

    for (const [symbol, candles] of candlesBySymbol) {
      const upTo = candles.filter((c) => c.t <= currentTimeMs);
      if (!upTo.length) continue;

      const first = upTo[0];
      const last = upTo[upTo.length - 1];
      let hod = -Infinity;
      let lod = Infinity;
      let vol = 0;
      for (const c of upTo) {
        if (c.h > hod) hod = c.h;
        if (c.l < lod) lod = c.l;
        vol += c.v;
      }

      const prevClose = prevCloseMap.get(symbol.toUpperCase());
      const item: SnapshotItem = {
        dailyBar: { t: '', o: first.o, h: hod, l: lod, c: last.c, v: vol },
        latestTrade: { p: last.c },
      };
      if (prevClose != null) {
        item.prevDailyBar = { t: '', o: 0, h: 0, l: 0, c: prevClose, v: 0 };
      }
      snapshots[symbol.toUpperCase()] = item;
    }

    return snapshots;
  }

  /**
   * Compute the combined list and track WHY each symbol is in the list.
   */
  computeCombinedList(
    snapshots: SnapshotsResponse,
    sessionDate: string,
    prevCloseMap: ReadonlyMap<string, number>,
    isAfterOpen: boolean,
  ): CombinedResult {
    const n = this.topN;
    const mv = this.minVolume;

    // Compute each ranking
    let gapperRanks: ScreenerRankRow[];
    if (isAfterOpen && this.cachedGapperRanks) {
      gapperRanks = this.cachedGapperRanks;
    } else {
      gapperRanks = rankTopGappers(snapshots, sessionDate, prevCloseMap, n, mv);
      this.cachedGapperRanks = gapperRanks;
    }

    const ranksByType: [ScreenerRankType, ScreenerRankRow[]][] = [
      ['gapper', gapperRanks],
      ['gainer_session', rankTopGainersSession(snapshots, sessionDate, prevCloseMap, n, mv)],
      ['gainer_intraday', rankTopGainersIntraday(snapshots, sessionDate, prevCloseMap, n, mv)],
      ['high_session', rankTopHighSession(snapshots, sessionDate, prevCloseMap, n, mv)],
      ['high_current', rankTopHighCurrent(snapshots, sessionDate, prevCloseMap, n, mv)],
    ];

    // Merge + dedup + track reasons
    const bySymbol = new Map<string, number>();
    const reasons = new Map<string, Set<ScreenerRankType>>();

    for (const [rankType, ranks] of ranksByType) {
      for (const r of ranks.slice(0, n)) {
        const sym = r.symbol.toUpperCase();
        const prev = bySymbol.get(sym) ?? 0;
        bySymbol.set(sym, Math.max(prev, Math.abs(r.metric_value)));

        let set = reasons.get(sym);
        if (!set) {
          set = new Set();
          reasons.set(sym, set);
        }
        set.add(rankType);
      }
    }

    const symbols = [...bySymbol.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n)
      .map(([sym]) => sym);

    // Only keep reasons for symbols that made it into the final list
    const filteredReasons = new Map<string, Set<ScreenerRankType>>();
    for (const sym of symbols) {
      const r = reasons.get(sym);
      if (r) filteredReasons.set(sym, r);
    }

    return { symbols, reasons: filteredReasons };
  }
}
