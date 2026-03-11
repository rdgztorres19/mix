"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbcdStrategy = void 0;
const session_utils_1 = require("../session.utils");
class AbcdStrategy {
    constructor() {
        this.name = 'ABCD';
    }
    matches(ctx) {
        return ((0, session_utils_1.isTheOpen)(ctx.session) || (0, session_utils_1.isLateMorning)(ctx.session)) &&
            ctx.abcdDetected && ctx.aboveVwap && ctx.aboveEma9;
    }
    getLevels(ctx) {
        const { price, ema9, atr, pre_market_high } = ctx;
        const ema = ema9 ?? price;
        return {
            entry: ema,
            stop: ema - atr * 0.25,
            target1: price + atr * 0.5,
            target2: pre_market_high ?? price + atr,
        };
    }
}
exports.AbcdStrategy = AbcdStrategy;
//# sourceMappingURL=abcd.strategy.js.map