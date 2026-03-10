"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "VwapFalseBreakoutStrategy", {
    enumerable: true,
    get: function() {
        return VwapFalseBreakoutStrategy;
    }
});
const _sessionutils = require("../session.utils");
let VwapFalseBreakoutStrategy = class VwapFalseBreakoutStrategy {
    matches(ctx) {
        return ((0, _sessionutils.isLateMorning)(ctx.session) || (0, _sessionutils.isMidday)(ctx.session)) && !ctx.aboveVwap;
    }
    getLevels(ctx) {
        const { price, vwap, atr } = ctx;
        return {
            entry: vwap ? vwap + 0.02 : price,
            stop: vwap ? vwap - atr * 0.15 : price - atr * 0.2,
            target1: price + atr * 0.4,
            target2: price + atr * 0.8
        };
    }
    constructor(){
        this.name = 'VWAP_FALSE_BREAKOUT';
    }
};

//# sourceMappingURL=vwap-false-breakout.strategy.js.map