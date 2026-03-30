"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "BacktestScreener", {
    enumerable: true,
    get: function() {
        return BacktestScreener;
    }
});
const _screenerrankers = require("../../scanner/screener/ranking/rankers/screener-rankers");
let BacktestScreener = class BacktestScreener {
    /**
   * Build synthetic snapshots from 1m bars accumulated up to the current minute.
   * All symbols use the same data source (1m bars) so rankings are consistent.
   * Input candles should already be filtered to upToMs by the caller.
   */ buildSyntheticSnapshots(candlesBySymbol, prevCloseMap) {
        const snapshots = {};
        for (const [symbol, candles] of candlesBySymbol){
            if (!candles.length) continue;
            const first = candles[0];
            const last = candles[candles.length - 1];
            let hod = -Infinity;
            let lod = Infinity;
            let vol = 0;
            for (const c of candles){
                if (c.h > hod) hod = c.h;
                if (c.l < lod) lod = c.l;
                vol += c.v;
            }
            const prevClose = prevCloseMap.get(symbol.toUpperCase());
            const item = {
                dailyBar: {
                    t: '',
                    o: first.o,
                    h: hod,
                    l: lod,
                    c: last.c,
                    v: vol
                },
                latestTrade: {
                    p: last.c
                }
            };
            if (prevClose != null) {
                item.prevDailyBar = {
                    t: '',
                    o: 0,
                    h: 0,
                    l: 0,
                    c: prevClose,
                    v: 0
                };
            }
            snapshots[symbol.toUpperCase()] = item;
        }
        return snapshots;
    }
    /**
   * Compute the combined list and track WHY each symbol is in the list.
   */ computeCombinedList(snapshots, sessionDate, prevCloseMap, isAfterOpen) {
        const n = this.topN;
        const mv = this.minVolume;
        // Compute each ranking
        let gapperRanks;
        if (isAfterOpen && this.cachedGapperRanks) {
            gapperRanks = this.cachedGapperRanks;
        } else {
            gapperRanks = (0, _screenerrankers.rankTopGappers)(snapshots, sessionDate, prevCloseMap, n, mv);
            this.cachedGapperRanks = gapperRanks;
        }
        const ranksByType = [
            [
                'gapper',
                gapperRanks
            ],
            [
                'gainer_session',
                (0, _screenerrankers.rankTopGainersSession)(snapshots, sessionDate, prevCloseMap, n, mv)
            ],
            [
                'gainer_intraday',
                (0, _screenerrankers.rankTopGainersIntraday)(snapshots, sessionDate, prevCloseMap, n, mv)
            ],
            [
                'high_session',
                (0, _screenerrankers.rankTopHighSession)(snapshots, sessionDate, prevCloseMap, n, mv)
            ],
            [
                'high_current',
                (0, _screenerrankers.rankTopHighCurrent)(snapshots, sessionDate, prevCloseMap, n, mv)
            ]
        ];
        // Merge + dedup + track reasons
        const bySymbol = new Map();
        const reasons = new Map();
        for (const [rankType, ranks] of ranksByType){
            for (const r of ranks.slice(0, n)){
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
        const symbols = [
            ...bySymbol.entries()
        ].sort((a, b)=>b[1] - a[1] || a[0].localeCompare(b[0]))// .slice(0, n)
        .slice(0, 30).map(([sym])=>sym);
        // Only keep reasons for symbols that made it into the final list
        const filteredReasons = new Map();
        for (const sym of symbols){
            const r = reasons.get(sym);
            if (r) filteredReasons.set(sym, r);
        }
        return {
            symbols,
            reasons: filteredReasons
        };
    }
    /**
   * Returns ALL symbols that appeared in ANY ranking (before the top-N cut).
   * Typically ~70-100 symbols vs ~40 from computeCombinedList.
   */ computeAllRankedSymbols(snapshots, sessionDate, prevCloseMap, isAfterOpen) {
        const n = this.topN;
        const mv = this.minVolume;
        let gapperRanks;
        if (isAfterOpen && this.cachedGapperRanks) {
            gapperRanks = this.cachedGapperRanks;
        } else {
            gapperRanks = (0, _screenerrankers.rankTopGappers)(snapshots, sessionDate, prevCloseMap, n, mv);
            this.cachedGapperRanks = gapperRanks;
        }
        const ranksByType = [
            [
                'gapper',
                gapperRanks
            ],
            [
                'gainer_session',
                (0, _screenerrankers.rankTopGainersSession)(snapshots, sessionDate, prevCloseMap, n, mv)
            ],
            [
                'gainer_intraday',
                (0, _screenerrankers.rankTopGainersIntraday)(snapshots, sessionDate, prevCloseMap, n, mv)
            ],
            [
                'high_session',
                (0, _screenerrankers.rankTopHighSession)(snapshots, sessionDate, prevCloseMap, n, mv)
            ],
            [
                'high_current',
                (0, _screenerrankers.rankTopHighCurrent)(snapshots, sessionDate, prevCloseMap, n, mv)
            ]
        ];
        // Merge ALL ranked symbols (no top-N cut on the final merge)
        const bySymbol = new Map();
        const reasons = new Map();
        for (const [rankType, ranks] of ranksByType){
            for (const r of ranks.slice(0, n)){
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
        // Return ALL — no .slice(0, n)
        const symbols = [
            ...bySymbol.entries()
        ].sort((a, b)=>b[1] - a[1] || a[0].localeCompare(b[0])).map(([sym])=>sym);
        return {
            symbols,
            reasons
        };
    }
    /**
   * Wide screener for ML training: returns top `limit` symbols with
   * per-ranker rank positions and metric values.
   */ computeCombinedListWide(snapshots, sessionDate, prevCloseMap, isAfterOpen, limit) {
        const n = this.topN;
        const mv = this.minVolume;
        let gapperRanks;
        if (isAfterOpen && this.cachedGapperRanks) {
            gapperRanks = this.cachedGapperRanks;
        } else {
            gapperRanks = (0, _screenerrankers.rankTopGappers)(snapshots, sessionDate, prevCloseMap, n, mv);
            this.cachedGapperRanks = gapperRanks;
        }
        const ranksByType = [
            [
                'gapper',
                gapperRanks
            ],
            [
                'gainer_session',
                (0, _screenerrankers.rankTopGainersSession)(snapshots, sessionDate, prevCloseMap, n, mv)
            ],
            [
                'gainer_intraday',
                (0, _screenerrankers.rankTopGainersIntraday)(snapshots, sessionDate, prevCloseMap, n, mv)
            ],
            [
                'high_session',
                (0, _screenerrankers.rankTopHighSession)(snapshots, sessionDate, prevCloseMap, n, mv)
            ],
            [
                'high_current',
                (0, _screenerrankers.rankTopHighCurrent)(snapshots, sessionDate, prevCloseMap, n, mv)
            ]
        ];
        const bySymbol = new Map();
        const reasons = new Map();
        const rankPositions = new Map();
        for (const [rankType, ranks] of ranksByType){
            const sliced = ranks.slice(0, n);
            for(let i = 0; i < sliced.length; i++){
                const r = sliced[i];
                const sym = r.symbol.toUpperCase();
                const prev = bySymbol.get(sym) ?? 0;
                bySymbol.set(sym, Math.max(prev, Math.abs(r.metric_value)));
                let set = reasons.get(sym);
                if (!set) {
                    set = new Set();
                    reasons.set(sym, set);
                }
                set.add(rankType);
                let posMap = rankPositions.get(sym);
                if (!posMap) {
                    posMap = new Map();
                    rankPositions.set(sym, posMap);
                }
                posMap.set(rankType, i);
            }
        }
        const sorted = [
            ...bySymbol.entries()
        ].sort((a, b)=>b[1] - a[1] || a[0].localeCompare(b[0]));
        const symbols = sorted.slice(0, limit).map(([sym])=>sym);
        const metricValues = new Map();
        const filteredReasons = new Map();
        const filteredRankPositions = new Map();
        for (const sym of symbols){
            metricValues.set(sym, bySymbol.get(sym));
            const r = reasons.get(sym);
            if (r) filteredReasons.set(sym, r);
            const rp = rankPositions.get(sym);
            if (rp) filteredRankPositions.set(sym, rp);
        }
        return {
            symbols,
            reasons: filteredReasons,
            rankPositions: filteredRankPositions,
            metricValues
        };
    }
    constructor(topN = 40, minVolume = 0){
        this.cachedGapperRanks = null;
        this.topN = topN;
        this.minVolume = minVolume;
    }
};

//# sourceMappingURL=screener.js.map