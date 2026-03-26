"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateAtr = calculateAtr;
function calculateAtr(candles, period = 14) {
    if (candles.length < 2)
        return 0;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
        const prev = candles[i - 1];
        const cur = candles[i];
        trs.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)));
    }
    const slice = trs.slice(-period);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
}
//# sourceMappingURL=atr.js.map