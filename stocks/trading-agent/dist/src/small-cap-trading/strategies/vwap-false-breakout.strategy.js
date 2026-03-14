"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VwapFalseBreakoutStrategy = void 0;
const session_utils_1 = require("../session.utils");
class VwapFalseBreakoutStrategy {
    constructor() {
        this.name = 'VWAP_FALSE_BREAKOUT';
    }
    matches(ctx) {
        return ((0, session_utils_1.isLateMorning)(ctx.session) || (0, session_utils_1.isMidday)(ctx.session)) && !ctx.aboveVwap;
    }
    getLevels(ctx) {
        const { price, vwap, atr } = ctx;
        return {
            entry: vwap ? vwap + 0.02 : price,
            stop: vwap ? vwap - atr * 0.15 : price - atr * 0.2,
            target1: price + atr * 0.4,
            target2: price + atr * 0.8,
        };
    }
}
exports.VwapFalseBreakoutStrategy = VwapFalseBreakoutStrategy;
//# sourceMappingURL=vwap-false-breakout.strategy.js.map