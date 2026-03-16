// Duplicated from stock-training/src/features/change.feature.ts - keep in sync for consistent features
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "computeChange", {
    enumerable: true,
    get: function() {
        return computeChange;
    }
});
function computeChange(candles, idx) {
    const closes = candles.map((c)=>c.c);
    const closeT = closes[idx];
    if (closeT == null || closeT <= 0) {
        return {
            change_1m: null,
            change_5m: null,
            change_10m: null
        };
    }
    const change1m = idx >= 1 && closes[idx - 1] > 0 ? (closeT - closes[idx - 1]) / closes[idx - 1] : null;
    const change5m = idx >= 5 && closes[idx - 5] > 0 ? (closeT - closes[idx - 5]) / closes[idx - 5] : null;
    const change10m = idx >= 10 && closes[idx - 10] > 0 ? (closeT - closes[idx - 10]) / closes[idx - 10] : null;
    return {
        change_1m: change1m,
        change_5m: change5m,
        change_10m: change10m
    };
}

//# sourceMappingURL=change.feature.js.map