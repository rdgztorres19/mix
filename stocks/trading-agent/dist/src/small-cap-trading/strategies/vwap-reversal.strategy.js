"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VwapReversalStrategy = void 0;
const session_utils_1 = require("../session.utils");
class VwapReversalStrategy {
    constructor() {
        this.name = 'VWAP_REVERSAL';
    }
    matches(ctx) {
        return ((0, session_utils_1.isTheOpen)(ctx.session) || (0, session_utils_1.isLateMorning)(ctx.session)) &&
            !ctx.aboveVwap && ctx.vwapReversalDetected;
    }
    getLevels(ctx) {
        const { price, vwap, ema9, atr } = ctx;
        const v = vwap ?? price;
        return {
            entry: v - atr * 0.1,
            stop: price - atr * 0.3,
            target1: v + atr * 0.3,
            target2: (ema9 ?? price) + atr * 0.6,
        };
    }
}
exports.VwapReversalStrategy = VwapReversalStrategy;
//# sourceMappingURL=vwap-reversal.strategy.js.map