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
function rankTopGappers(snapshots, _sessionDate, prevCloseBySymbol, topN, minVolume) {
    const acc = [];
    for (const [symbol, item] of Object.entries(snapshots)){
        if (symbol === 'ONCO') {
            console.log('item', item);
        }
        const dailyBar = item?.dailyBar;
        if (!dailyBar) continue;
        const v = dailyBar.v ?? 0;
        if (!Number.isFinite(v) || v < minVolume) continue;
        const prev = prevCloseForItem(symbol, item, prevCloseBySymbol);
        if (prev == null || !Number.isFinite(dailyBar.o) || dailyBar.o <= 0) continue;
        const gapPct = (dailyBar.o - prev) / prev * 100;
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
                volume: v
            }
        });
    }
    return sortByMetricThenVolume(acc, topN, 'gapper');
}
function rankTopGainersSession(snapshots, _sessionDate, prevCloseBySymbol, topN, minVolume) {
    const acc = [];
    for (const [symbol, item] of Object.entries(snapshots)){
        const dailyBar = item?.dailyBar;
        if (!dailyBar) continue;
        const v = dailyBar.v ?? 0;
        if (!Number.isFinite(v) || v < minVolume) continue;
        const prev = prevCloseForItem(symbol, item, prevCloseBySymbol);
        if (prev == null || !Number.isFinite(dailyBar.c) || dailyBar.c <= 0) continue;
        const pct = (dailyBar.c - prev) / prev * 100;
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
                volume: v
            }
        });
    }
    return sortByMetricThenVolume(acc, topN, 'gainer_session');
}
function rankTopGainersIntraday(snapshots, _sessionDate, prevCloseBySymbol, topN, minVolume) {
    const acc = [];
    for (const [symbol, item] of Object.entries(snapshots)){
        const dailyBar = item?.dailyBar;
        if (!dailyBar) continue;
        const v = dailyBar.v ?? 0;
        if (!Number.isFinite(v) || v < minVolume) continue;
        const prev = prevCloseForItem(symbol, item, prevCloseBySymbol);
        if (prev == null) continue;
        const last = item.latestTrade?.p ?? dailyBar.c;
        if (!Number.isFinite(last) || last <= 0) continue;
        const pct = (last - prev) / prev * 100;
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
                volume: v
            }
        });
    }
    return sortByMetricThenVolume(acc, topN, 'gainer_intraday');
}
function rankTopHighSession(snapshots, _sessionDate, prevCloseBySymbol, topN, minVolume) {
    const acc = [];
    for (const [symbol, item] of Object.entries(snapshots)){
        const dailyBar = item?.dailyBar;
        if (!dailyBar) continue;
        const v = dailyBar.v ?? 0;
        if (!Number.isFinite(v) || v < minVolume) continue;
        const prev = prevCloseForItem(symbol, item, prevCloseBySymbol);
        if (prev == null || !Number.isFinite(dailyBar.h) || dailyBar.h <= 0) continue;
        const pct = (dailyBar.h - prev) / prev * 100;
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
                volume: v
            }
        });
    }
    return sortByMetricThenVolume(acc, topN, 'high_session');
}
function rankTopHighCurrent(snapshots, _sessionDate, prevCloseBySymbol, topN, minVolume) {
    const acc = [];
    for (const [symbol, item] of Object.entries(snapshots)){
        const dailyBar = item?.dailyBar;
        if (!dailyBar) continue;
        const v = dailyBar.v ?? 0;
        if (!Number.isFinite(v) || v < minVolume) continue;
        const prev = prevCloseForItem(symbol, item, prevCloseBySymbol);
        if (prev == null || !Number.isFinite(dailyBar.h) || dailyBar.h <= 0) continue;
        const lt = item.latestTrade?.p;
        const effectiveHigh = lt != null && Number.isFinite(lt) ? Math.max(dailyBar.h, lt) : dailyBar.h;
        const pct = (effectiveHigh - prev) / prev * 100;
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
                volume: v
            }
        });
    }
    return sortByMetricThenVolume(acc, topN, 'high_current');
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