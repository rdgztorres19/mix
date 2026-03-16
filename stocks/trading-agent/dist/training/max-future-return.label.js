// Duplicated from stock-training/src/labels/max-future-return.label.ts - keep in sync for consistent features
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "computeMaxFutureReturn10m", {
    enumerable: true,
    get: function() {
        return computeMaxFutureReturn10m;
    }
});
function computeMaxFutureReturn10m(candles, idx) {
    if (idx + 10 >= candles.length) return null;
    const closeT = candles[idx].c;
    if (closeT <= 0) return null;
    let maxHigh = 0;
    for(let j = idx + 1; j <= idx + 10; j++){
        if (candles[j]?.h > maxHigh) maxHigh = candles[j].h;
    }
    return (maxHigh - closeT) / closeT;
}

//# sourceMappingURL=max-future-return.label.js.map