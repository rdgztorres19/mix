"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "GeneralStrategy", {
    enumerable: true,
    get: function() {
        return GeneralStrategy;
    }
});
let GeneralStrategy = class GeneralStrategy {
    matches(_ctx) {
        return true; // Always matches as fallback
    }
    getLevels(ctx) {
        const { price, atr } = ctx;
        return {
            entry: price,
            stop: price - atr * 0.3,
            target1: price + atr * 0.5,
            target2: price + atr
        };
    }
    constructor(){
        this.name = 'GENERAL';
    }
};

//# sourceMappingURL=general.strategy.js.map