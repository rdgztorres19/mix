// Duplicated from stock-training/src/labels/future-return.label.ts - keep in sync for consistent features
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "computeFutureReturn5m", {
    enumerable: true,
    get: function() {
        return computeFutureReturn5m;
    }
});
function computeFutureReturn5m(candles, idx) {
    if (idx + 5 >= candles.length) return null;
    const closeT = candles[idx].c;
    const closeT5 = candles[idx + 5].c;
    if (closeT <= 0) return null;
    return (closeT5 - closeT) / closeT;
}

//# sourceMappingURL=future-return.label.js.map