"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CandleCache", {
    enumerable: true,
    get: function() {
        return CandleCache;
    }
});
let CandleCache = class CandleCache {
    get symbols() {
        return [
            ...this.cache.keys()
        ];
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
        // Evict symbols no longer in the combined list
        for (const sym of this.cache.keys()){
            if (!upper.includes(sym)) this.cache.delete(sym);
        }
    }
    loadFromBars(barsMap) {
        for (const [sym, bars] of barsMap){
            this.cache.set(sym.toUpperCase(), alpacaBarsToCandles(bars));
        }
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