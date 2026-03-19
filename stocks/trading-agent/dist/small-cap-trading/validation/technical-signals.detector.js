"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "TechnicalSignalsDetector", {
    enumerable: true,
    get: function() {
        return TechnicalSignalsDetector;
    }
});
let TechnicalSignalsDetector = class TechnicalSignalsDetector {
    detect(ctx) {
        const signals = [];
        if (ctx.vwap && ctx.price > ctx.vwap) {
            signals.push(`Price above VWAP ($${ctx.vwap.toFixed(2)})`);
        }
        if (ctx.vwap && ctx.price < ctx.vwap) {
            signals.push(`Price below VWAP ($${ctx.vwap.toFixed(2)})`);
        }
        if (ctx.ema9 && ctx.price > ctx.ema9) {
            signals.push(`Price above EMA9 ($${ctx.ema9.toFixed(2)})`);
        }
        if (ctx.ema20 && ctx.price > ctx.ema20) {
            signals.push(`Price above EMA20 ($${ctx.ema20.toFixed(2)})`);
        }
        if (ctx.relative_volume >= 5) {
            signals.push(`Strong relative volume: ${ctx.relative_volume.toFixed(1)}x`);
        }
        if (ctx.change_pct >= 0.2) {
            signals.push(`Strong momentum: +${(ctx.change_pct * 100).toFixed(1)}% today`);
        }
        return signals;
    }
};

//# sourceMappingURL=technical-signals.detector.js.map