"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "VwapReversalStrategy", {
    enumerable: true,
    get: function() {
        return VwapReversalStrategy;
    }
});
const _sessionutils = require("../session.utils");
let VwapReversalStrategy = class VwapReversalStrategy {
    matches(ctx) {
        return ((0, _sessionutils.isTheOpen)(ctx.session) || (0, _sessionutils.isLateMorning)(ctx.session)) && !ctx.aboveVwap && ctx.vwapReversalDetected;
    }
    getLevels(ctx) {
        const { price, vwap, ema9, atr } = ctx;
        const v = vwap ?? price;
        return {
            entry: v - atr * 0.1,
            stop: price - atr * 0.3,
            target1: v + atr * 0.3,
            target2: (ema9 ?? price) + atr * 0.6
        };
    }
    constructor(){
        this.name = 'VWAP_REVERSAL';
    }
};

//# sourceMappingURL=vwap-reversal.strategy.js.map