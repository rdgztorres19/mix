/**
 * Position sizing: 2% max risk rule.
 * shareSize = floor(maxRisk / perShareRisk), perShareRisk = max(entry - stop, 0.05)
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PositionSizer", {
    enumerable: true,
    get: function() {
        return PositionSizer;
    }
});
let PositionSizer = class PositionSizer {
    size(accountSize, entry, stop, target1) {
        const maxRisk = accountSize * this.maxRiskPct;
        const perShareRisk = Math.max(entry - stop, this.minRiskPerShare);
        const shareSize = Math.floor(maxRisk / perShareRisk);
        const rrRatio = (target1 - entry) / perShareRisk;
        return {
            shareSize,
            maxRisk,
            perShareRisk,
            rrRatio
        };
    }
    constructor(){
        this.minRiskPerShare = 0.05;
        this.maxRiskPct = 0.02;
    }
};

//# sourceMappingURL=position-sizer.js.map