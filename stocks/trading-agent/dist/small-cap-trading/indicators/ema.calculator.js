/**
 * EMA calculator — Exponential Moving Average.
 * k = 2 / (period + 1), EMA = close * k + prevEMA * (1 - k)
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "EmaCalculator", {
    enumerable: true,
    get: function() {
        return EmaCalculator;
    }
});
let EmaCalculator = class EmaCalculator {
    static calculate(values, period) {
        if (values.length < period) return null;
        const k = 2 / (period + 1);
        let ema = values.slice(0, period).reduce((s, v)=>s + v, 0) / period;
        for(let i = period; i < values.length; i++){
            ema = values[i] * k + ema * (1 - k);
        }
        return ema;
    }
};

//# sourceMappingURL=ema.calculator.js.map