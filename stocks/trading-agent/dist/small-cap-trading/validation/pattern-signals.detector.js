"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PatternSignalsDetector", {
    enumerable: true,
    get: function() {
        return PatternSignalsDetector;
    }
});
const _bullflagdetector = require("./bull-flag.detector");
const _abcddetector = require("./abcd.detector");
const _orbdetector = require("./orb.detector");
const _vwapreversaldetector = require("./vwap-reversal.detector");
const _fallenangeldetector = require("./fallen-angel.detector");
const _technicalsignalsdetector = require("./technical-signals.detector");
let PatternSignalsDetector = class PatternSignalsDetector {
    detect(ctx) {
        const patterns = [];
        const signals = [];
        // Run all pattern detectors
        const bullFlagResult = this.bullFlag.detect(ctx.candles);
        const abcdResult = this.abcd.detect(ctx.candles);
        const orbResult = this.orb.detect(ctx.candles, ctx.atr);
        const vwapReversalResult = this.vwapReversal.detect(ctx.candles, ctx.vwap);
        const fallenAngelResult = this.fallenAngel.detect(ctx.candles, ctx.pre_market_high);
        if (bullFlagResult.detected) {
            patterns.push(bullFlagResult);
            signals.push(bullFlagResult.description);
        }
        if (abcdResult.detected) {
            patterns.push(abcdResult);
            signals.push(abcdResult.description);
        }
        if (orbResult.detected) {
            patterns.push(orbResult);
            signals.push(orbResult.description);
        }
        if (vwapReversalResult.detected) {
            patterns.push(vwapReversalResult);
            signals.push(vwapReversalResult.description);
        }
        if (fallenAngelResult.detected) {
            patterns.push(fallenAngelResult);
            signals.push(fallenAngelResult.description);
        }
        // Add technical context signals
        signals.push(...this.technical.detect(ctx));
        return {
            signals,
            bullFlagDetected: bullFlagResult.detected,
            abcdDetected: abcdResult.detected,
            orbDetected: orbResult.detected,
            vwapReversalDetected: vwapReversalResult.detected,
            fallenAngelDetected: fallenAngelResult.detected,
            patterns
        };
    }
    constructor(){
        this.bullFlag = new _bullflagdetector.BullFlagDetector();
        this.abcd = new _abcddetector.AbcdDetector();
        this.orb = new _orbdetector.OrbDetector();
        this.vwapReversal = new _vwapreversaldetector.VwapReversalDetector();
        this.fallenAngel = new _fallenangeldetector.FallenAngelDetector();
        this.technical = new _technicalsignalsdetector.TechnicalSignalsDetector();
    }
};

//# sourceMappingURL=pattern-signals.detector.js.map