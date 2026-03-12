"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "VwapMaTrendStrategy", {
    enumerable: true,
    get: function() {
        return VwapMaTrendStrategy;
    }
});
const _sessionutils = require("../session.utils");
let VwapMaTrendStrategy = class VwapMaTrendStrategy {
    matches(ctx) {
        return ((0, _sessionutils.isMidday)(ctx.session) || (0, _sessionutils.isTheClose)(ctx.session)) && ctx.aboveVwap && ctx.aboveEma20;
    }
    getLevels(ctx) {
        const { price, ema20, atr } = ctx;
        const ema = ema20 ?? price;
        return {
            entry: ema,
            stop: ema - atr * 0.2,
            target1: price + atr * 0.4,
            target2: price + atr * 0.8
        };
    }
    constructor(){
        this.name = 'VWAP_MA_TREND';
    }
};

//# sourceMappingURL=vwap-ma-trend.strategy.js.map