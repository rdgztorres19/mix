"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AbcdStrategy", {
    enumerable: true,
    get: function() {
        return AbcdStrategy;
    }
});
const _sessionutils = require("../session.utils");
let AbcdStrategy = class AbcdStrategy {
    matches(ctx) {
        return ((0, _sessionutils.isTheOpen)(ctx.session) || (0, _sessionutils.isLateMorning)(ctx.session)) && ctx.abcdDetected && ctx.aboveVwap && ctx.aboveEma9;
    }
    getLevels(ctx) {
        const { price, ema9, atr, pre_market_high } = ctx;
        const ema = ema9 ?? price;
        return {
            entry: ema,
            stop: ema - atr * 0.25,
            target1: price + atr * 0.5,
            target2: pre_market_high ?? price + atr
        };
    }
    constructor(){
        this.name = 'ABCD';
    }
};

//# sourceMappingURL=abcd.strategy.js.map