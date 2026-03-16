"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "OrbStrategy", {
    enumerable: true,
    get: function() {
        return OrbStrategy;
    }
});
const _sessionutils = require("../session.utils");
let OrbStrategy = class OrbStrategy {
    matches(ctx) {
        return (0, _sessionutils.isTheOpen)(ctx.session) && ctx.orbDetected;
    }
    getLevels(ctx) {
        const { price, vwap, atr, pre_market_high } = ctx;
        const v = vwap ?? price;
        // ORB: entry at breakout, stop below VWAP (for longs)
        return {
            entry: price + 0.02,
            stop: v - atr * 0.1,
            target1: pre_market_high ?? price + atr * 0.5,
            target2: price + atr
        };
    }
    constructor(){
        this.name = 'ORB';
    }
};

//# sourceMappingURL=orb.strategy.js.map