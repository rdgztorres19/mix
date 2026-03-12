"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeneralStrategy = void 0;
class GeneralStrategy {
    constructor() {
        this.name = 'GENERAL';
    }
    matches(_ctx) {
        return true;
    }
    getLevels(ctx) {
        const { price, atr } = ctx;
        return {
            entry: price,
            stop: price - atr * 0.3,
            target1: price + atr * 0.5,
            target2: price + atr,
        };
    }
}
exports.GeneralStrategy = GeneralStrategy;
//# sourceMappingURL=general.strategy.js.map