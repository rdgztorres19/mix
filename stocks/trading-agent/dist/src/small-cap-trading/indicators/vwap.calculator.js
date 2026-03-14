"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VwapCalculator = void 0;
class VwapCalculator {
    static calculate(candles) {
        if (!candles.length)
            return null;
        let totalPV = 0;
        let totalV = 0;
        for (const c of candles) {
            const typical = (c.h + c.l + c.c) / 3;
            totalPV += typical * c.v;
            totalV += c.v;
        }
        return totalV > 0 ? totalPV / totalV : null;
    }
    static calculateLine(candles) {
        const points = [];
        let cumPV = 0, cumV = 0;
        for (const c of candles) {
            const typical = (c.h + c.l + c.c) / 3;
            cumPV += typical * c.v;
            cumV += c.v;
            if (cumV > 0)
                points.push({ t: Math.floor(c.t / 1000), value: cumPV / cumV });
        }
        return points;
    }
}
exports.VwapCalculator = VwapCalculator;
//# sourceMappingURL=vwap.calculator.js.map