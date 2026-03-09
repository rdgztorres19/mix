"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrbStrategy = void 0;
const session_utils_1 = require("../session.utils");
class OrbStrategy {
    constructor() {
        this.name = 'ORB';
    }
    matches(ctx) {
        return (0, session_utils_1.isTheOpen)(ctx.session) && ctx.orbDetected;
    }
    getLevels(ctx) {
        const { price, vwap, atr, pre_market_high } = ctx;
        const v = vwap ?? price;
        return {
            entry: price + 0.02,
            stop: v - atr * 0.1,
            target1: pre_market_high ?? price + atr * 0.5,
            target2: price + atr,
        };
    }
}
exports.OrbStrategy = OrbStrategy;
//# sourceMappingURL=orb.strategy.js.map