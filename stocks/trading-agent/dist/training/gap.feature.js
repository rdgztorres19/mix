// Duplicated from stock-training/src/features/gap.feature.ts - keep in sync for consistent features
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "computeGapPct", {
    enumerable: true,
    get: function() {
        return computeGapPct;
    }
});
function computeGapPct(priorClose, openFirst) {
    if (priorClose <= 0) return null;
    return (openFirst - priorClose) / priorClose;
}

//# sourceMappingURL=gap.feature.js.map