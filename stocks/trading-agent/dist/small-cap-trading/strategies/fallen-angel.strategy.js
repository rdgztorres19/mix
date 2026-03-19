"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "FallenAngelStrategy", {
    enumerable: true,
    get: function() {
        return FallenAngelStrategy;
    }
});
const _sessionutils = require("../session.utils");
let FallenAngelStrategy = class FallenAngelStrategy {
    matches(ctx) {
        return (0, _sessionutils.isTheOpen)(ctx.session) && ctx.fallenAngelDetected;
    }
    getLevels(ctx) {
        const { price, vwap, atr, pre_market_high, candles } = ctx;
        const v = vwap ?? price;
        // Stop below consolidation low (approx: recent low of last 3 candles)
        const recentLow = candles.length >= 3 ? Math.min(...candles.slice(-3).map((c)=>c.l)) : price - atr * 0.3;
        return {
            entry: price + 0.02,
            stop: recentLow,
            target1: v,
            target2: pre_market_high ?? price + atr
        };
    }
    constructor(){
        this.name = 'FALLEN_ANGEL';
    }
};

//# sourceMappingURL=fallen-angel.strategy.js.map