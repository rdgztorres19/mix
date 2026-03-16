// Duplicated from stock-training/src/indicators/vwap.ts - keep in sync for consistent features
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "calculateVwap", {
    enumerable: true,
    get: function() {
        return calculateVwap;
    }
});
function calculateVwap(candles) {
    if (!candles.length) return null;
    let totalPV = 0;
    let totalV = 0;
    for (const c of candles){
        const typical = (c.h + c.l + c.c) / 3;
        totalPV += typical * c.v;
        totalV += c.v;
    }
    return totalV > 0 ? totalPV / totalV : null;
}

//# sourceMappingURL=vwap.js.map