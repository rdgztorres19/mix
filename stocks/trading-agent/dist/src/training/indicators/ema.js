"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateEma = calculateEma;
function calculateEma(values, period) {
    if (values.length < period)
        return null;
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
    }
    return ema;
}
//# sourceMappingURL=ema.js.map