"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VwapMaTrendStrategy = void 0;
const session_utils_1 = require("../session.utils");
class VwapMaTrendStrategy {
    constructor() {
        this.name = 'VWAP_MA_TREND';
    }
    matches(ctx) {
        return (((0, session_utils_1.isMidday)(ctx.session) || (0, session_utils_1.isTheClose)(ctx.session)) &&
            ctx.aboveVwap &&
            ctx.aboveEma20);
    }
    getLevels(ctx) {
        const { price, ema20, atr } = ctx;
        const ema = ema20 ?? price;
        return {
            entry: ema,
            stop: ema - atr * 0.2,
            target1: price + atr * 0.4,
            target2: price + atr * 0.8,
        };
    }
}
exports.VwapMaTrendStrategy = VwapMaTrendStrategy;
//# sourceMappingURL=vwap-ma-trend.strategy.js.map