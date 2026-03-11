"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PositionSizer = void 0;
class PositionSizer {
    constructor() {
        this.minRiskPerShare = 0.05;
        this.maxRiskPct = 0.02;
    }
    size(accountSize, entry, stop, target1) {
        const maxRisk = accountSize * this.maxRiskPct;
        const perShareRisk = Math.max(entry - stop, this.minRiskPerShare);
        const shareSize = Math.floor(maxRisk / perShareRisk);
        const rrRatio = (target1 - entry) / perShareRisk;
        return {
            shareSize,
            maxRisk,
            perShareRisk,
            rrRatio,
        };
    }
}
exports.PositionSizer = PositionSizer;
//# sourceMappingURL=position-sizer.js.map