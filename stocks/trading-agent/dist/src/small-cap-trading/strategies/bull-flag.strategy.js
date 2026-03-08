"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BullFlagStrategy = void 0;
const session_utils_1 = require("../session.utils");
class BullFlagStrategy {
    constructor() {
        this.name = 'BULL_FLAG';
    }
    matches(ctx) {
        return (0, session_utils_1.isTheOpen)(ctx.session) && ctx.bullFlagDetected && ctx.aboveVwap;
    }
    getLevels(ctx) {
        const { price, atr, pre_market_high, candles } = ctx;
        const stop = candles.length >= 2
            ? Math.min(...candles.slice(-2).map((c) => c.l))
            : price - atr * 0.3;
        const t1 = pre_market_high ?? price + atr * 0.5;
        const t2 = price + atr;
        return {
            entry: price + 0.02,
            stop,
            target1: t1,
            target2: t2,
        };
    }
}
exports.BullFlagStrategy = BullFlagStrategy;
//# sourceMappingURL=bull-flag.strategy.js.map