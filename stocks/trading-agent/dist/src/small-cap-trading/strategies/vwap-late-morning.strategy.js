"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VwapLateMorningStrategy = void 0;
const session_utils_1 = require("../session.utils");
class VwapLateMorningStrategy {
    constructor() {
        this.name = 'VWAP_LATE_MORNING';
    }
    matches(ctx) {
        return (0, session_utils_1.isLateMorning)(ctx.session) && ctx.aboveVwap;
    }
    getLevels(ctx) {
        const { price, vwap, atr, ema9 } = ctx;
        const v = vwap ?? price;
        const ema = ema9 ?? price;
        return {
            entry: price,
            stop: Math.min(v - atr * 0.15, ema - atr * 0.2),
            target1: price + atr * 0.5,
            target2: price + atr,
        };
    }
}
exports.VwapLateMorningStrategy = VwapLateMorningStrategy;
//# sourceMappingURL=vwap-late-morning.strategy.js.map