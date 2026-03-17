"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeGapPct = computeGapPct;
function computeGapPct(priorClose, openFirst) {
    if (priorClose <= 0)
        return null;
    return (openFirst - priorClose) / priorClose;
}
//# sourceMappingURL=gap.feature.js.map