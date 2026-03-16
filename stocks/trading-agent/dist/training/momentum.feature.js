// Duplicated from stock-training/src/features/momentum.feature.ts - keep in sync for consistent features
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "computeMomentumAcumulado", {
    enumerable: true,
    get: function() {
        return computeMomentumAcumulado;
    }
});
function computeMomentumAcumulado(close, openDay) {
    if (openDay <= 0) return null;
    return (close - openDay) / openDay;
}

//# sourceMappingURL=momentum.feature.js.map