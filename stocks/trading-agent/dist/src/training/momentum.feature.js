"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeMomentumAcumulado = computeMomentumAcumulado;
function computeMomentumAcumulado(close, openDay) {
    if (openDay <= 0)
        return null;
    return (close - openDay) / openDay;
}
//# sourceMappingURL=momentum.feature.js.map