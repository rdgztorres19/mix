"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "BullFlagStrategy", {
    enumerable: true,
    get: function() {
        return BullFlagStrategy;
    }
});
const _sessionutils = require("../session.utils");
let BullFlagStrategy = class BullFlagStrategy {
    matches(ctx) {
        return ((0, _sessionutils.isTheOpen)(ctx.session) || (0, _sessionutils.isLateMorning)(ctx.session)) && ctx.bullFlagDetected && ctx.aboveVwap;
    }
    getLevels(ctx) {
        const { price, atr, pre_market_high, candles } = ctx;
        const stop = candles.length >= 2 ? Math.min(...candles.slice(-2).map((c)=>c.l)) : price - atr * 0.3;
        const t1 = pre_market_high ?? price + atr * 0.5;
        const t2 = price + atr;
        return {
            entry: price + 0.02,
            stop,
            target1: t1,
            target2: t2
        };
    }
    constructor(){
        this.name = 'BULL_FLAG';
    }
};

//# sourceMappingURL=bull-flag.strategy.js.map