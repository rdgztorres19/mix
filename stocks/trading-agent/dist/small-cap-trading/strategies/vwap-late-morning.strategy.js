"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "VwapLateMorningStrategy", {
    enumerable: true,
    get: function() {
        return VwapLateMorningStrategy;
    }
});
const _sessionutils = require("../session.utils");
let VwapLateMorningStrategy = class VwapLateMorningStrategy {
    matches(ctx) {
        return (0, _sessionutils.isLateMorning)(ctx.session) && ctx.aboveVwap;
    }
    getLevels(ctx) {
        const { price, vwap, atr, ema9 } = ctx;
        const v = vwap ?? price;
        const ema = ema9 ?? price;
        return {
            entry: price,
            stop: Math.min(v - atr * 0.15, ema - atr * 0.2),
            target1: price + atr * 0.5,
            target2: price + atr
        };
    }
    constructor(){
        this.name = 'VWAP_LATE_MORNING';
    }
};

//# sourceMappingURL=vwap-late-morning.strategy.js.map