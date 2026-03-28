"use strict";
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
    get CandleCache () {
        return CandleCache;
    },
    get alpacaBarsToCandles () {
        return alpacaBarsToCandles;
    }
});
let CandleCache = class CandleCache {
    get symbols() {
        return [
            ...this.cache.keys()
        ];
    }
    get symbolCount() {
        return this.cache.size;
    }
    has(symbol) {
        return this.cache.has(symbol.toUpperCase());
    }
    async ensureSymbols(symbols, date, client) {
        const upper = symbols.map((s)=>s.toUpperCase());
        const missing = upper.filter((s)=>!this.cache.has(s));
        if (missing.length > 0) {
            console.log(`  [Cache] Fetching 1m bars for ${missing.length} new symbols...`);
            const bars = await client.fetch1mBars(missing, date);
            for (const [sym, barArr] of bars){
                this.cache.set(sym, alpacaBarsToCandles(barArr));
            }
        }
    }
    loadFromBars(barsMap) {
        for (const [sym, bars] of barsMap){
            this.cache.set(sym.toUpperCase(), alpacaBarsToCandles(bars));
        }
    }
    /** Returns all cached symbols' candles filtered up to the given timestamp. */ getAllSymbolCandles(upToMs) {
        const result = new Map();
        for (const [sym, candles] of this.cache){
            const upTo = candles.filter((c)=>c.t <= upToMs);
            if (upTo.length > 0) {
                result.set(sym, upTo);
            }
        }
        return result;
    }
    getCandlesUpTo(symbol, currentTimeMs) {
        const all = this.cache.get(symbol.toUpperCase());
        if (!all) return [];
        return all.filter((c)=>c.t <= currentTimeMs);
    }
    getAllCandles(symbol) {
        return this.cache.get(symbol.toUpperCase()) ?? [];
    }
    constructor(){
        this.cache = new Map();
    }
};
function alpacaBarsToCandles(bars) {
    return bars.map((b)=>({
            o: b.o,
            h: b.h,
            l: b.l,
            c: b.c,
            v: b.v,
            t: new Date(b.t).getTime()
        }));
}

//# sourceMappingURL=candle-cache.js.map