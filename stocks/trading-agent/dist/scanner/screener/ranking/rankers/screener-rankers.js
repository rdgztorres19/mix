/**
 * Pure ranking from Alpaca-style snapshots (+ optional prev close overlay).
 * Aligned with stocks/stock-training/scripts/download-gainers.ts where noted.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get barsPrevCloseBeforeSession () {
        return barsPrevCloseBeforeSession;
    },
    get rankTopGainersIntraday () {
        return rankTopGainersIntraday;
    },
    get rankTopGainersSession () {
        return rankTopGainersSession;
    },
    get rankTopGappers () {
        return rankTopGappers;
    },
    get rankTopHighCurrent () {
        return rankTopHighCurrent;
    },
    get rankTopHighSession () {
        return rankTopHighSession;
    }
});
function getDateOnly(iso) {
    return iso.slice(0, 10);
}
function prevCloseForItem(symbol, item, prevCloseBySymbol) {
    const fromDb = prevCloseBySymbol.get(symbol.toUpperCase());
    // Prefer DB prev_close because it is filled via daily bars (with split adjustment)
    // and avoids relying on snapshot prevDailyBar semantics.
    if (fromDb != null && Number.isFinite(fromDb) && fromDb > 0) return fromDb;
    const fromBar = item.prevDailyBar?.c;
    return fromBar != null && Number.isFinite(fromBar) && fromBar > 0 ? fromBar : null;
}
function sortByMetricThenVolume(rows, topN, rankType) {
    return rows.sort((a, b)=>{
        if (b.metric !== a.metric) return b.metric - a.metric;
        return (b.volume || 0) - (a.volume || 0);
    }).slice(0, topN).map((r, idx)=>({
            rank_type: rankType,
            rank_order: idx + 1,
            symbol: r.symbol,
            metric_value: r.metric,
            ...r.extras
        }));
}
function rankByMetric(snapshots, prevCloseBySymbol, topN, minVolume, rankType, metricFn) {
    const acc = [];
    for (const [symbol, item] of Object.entries(snapshots)){
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
                volume: v
            }
        });
    }
    return sortByMetricThenVolume(acc, topN, rankType);
}
function rankTopGappers(snapshots, _sessionDate, prevCloseBySymbol, topN, minVolume) {
    return rankByMetric(snapshots, prevCloseBySymbol, topN, minVolume, 'gapper', (bar, prev)=>{
        if (!Number.isFinite(bar.o) || bar.o <= 0) return null;
        return {
            metric: (bar.o - prev) / prev * 100
        };
    });
}
function rankTopGainersSession(snapshots, _sessionDate, prevCloseBySymbol, topN, minVolume) {
    return rankByMetric(snapshots, prevCloseBySymbol, topN, minVolume, 'gainer_session', (bar, prev)=>{
        return {
            metric: (bar.c - prev) / prev * 100
        };
    });
}
function rankTopGainersIntraday(snapshots, _sessionDate, prevCloseBySymbol, topN, minVolume) {
    return rankByMetric(snapshots, prevCloseBySymbol, topN, minVolume, 'gainer_intraday', (bar, prev, item)=>{
        const last = item.latestTrade?.p ?? bar.c;
        if (!Number.isFinite(last) || last <= 0) return null;
        return {
            metric: (last - prev) / prev * 100,
            closeOverride: last
        };
    });
}
function rankTopHighSession(snapshots, _sessionDate, prevCloseBySymbol, topN, minVolume) {
    return rankByMetric(snapshots, prevCloseBySymbol, topN, minVolume, 'high_session', (bar, prev)=>{
        if (!Number.isFinite(bar.h) || bar.h <= 0) return null;
        return {
            metric: (bar.h - prev) / prev * 100
        };
    });
}
function rankTopHighCurrent(snapshots, _sessionDate, prevCloseBySymbol, topN, minVolume) {
    return rankByMetric(snapshots, prevCloseBySymbol, topN, minVolume, 'high_current', (bar, prev, item)=>{
        if (!Number.isFinite(bar.h) || bar.h <= 0) return null;
        const lt = item.latestTrade?.p;
        const effectiveHigh = lt != null && Number.isFinite(lt) ? Math.max(bar.h, lt) : bar.h;
        return {
            metric: (effectiveHigh - prev) / prev * 100,
            highOverride: effectiveHigh
        };
    });
}
function barsPrevCloseBeforeSession(bars, sessionDate) {
    if (!bars?.length) return null;
    const before = bars.filter((b)=>getDateOnly(b.t) < sessionDate);
    if (!before.length) return null;
    const last = before[before.length - 1];
    const c = last.c;
    return Number.isFinite(c) && c > 0 ? c : null;
}

//# sourceMappingURL=screener-rankers.js.map