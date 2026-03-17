"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskManager = void 0;
class RiskManager {
    constructor() {
        this.minRrRatio = 2;
    }
    validate(levels, sizing, accountSize) {
        const warnings = [];
        if (sizing.rrRatio < this.minRrRatio) {
            warnings.push(`R/R ratio ${sizing.rrRatio.toFixed(1)}:1 — below 2:1 minimum, consider skipping`);
        }
        const perShareRisk = levels.entry - levels.stop;
        if (perShareRisk < 0.05) {
            warnings.push('Stop too tight: per-share risk < $0.05');
        }
        const actualRisk = sizing.shareSize * sizing.perShareRisk;
        const maxRisk = accountSize * 0.02;
        if (actualRisk > maxRisk * 1.01) {
            warnings.push(`Position exceeds 2% max risk: $${actualRisk.toFixed(0)} > $${maxRisk.toFixed(0)}`);
        }
        return {
            passed: warnings.length === 0,
            warnings,
        };
    }
}
exports.RiskManager = RiskManager;
//# sourceMappingURL=risk-manager.js.map