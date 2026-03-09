"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FallenAngelStrategy = void 0;
const session_utils_1 = require("../session.utils");
class FallenAngelStrategy {
    constructor() {
        this.name = 'FALLEN_ANGEL';
    }
    matches(ctx) {
        return (0, session_utils_1.isTheOpen)(ctx.session) && ctx.fallenAngelDetected;
    }
    getLevels(ctx) {
        const { price, vwap, atr, pre_market_high, candles } = ctx;
        const v = vwap ?? price;
        const recentLow = candles.length >= 3
            ? Math.min(...candles.slice(-3).map((c) => c.l))
            : price - atr * 0.3;
        return {
            entry: price + 0.02,
            stop: recentLow,
            target1: v,
            target2: pre_market_high ?? price + atr,
        };
    }
}
exports.FallenAngelStrategy = FallenAngelStrategy;
//# sourceMappingURL=fallen-angel.strategy.js.map