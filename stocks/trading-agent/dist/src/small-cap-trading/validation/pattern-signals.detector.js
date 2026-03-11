"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatternSignalsDetector = void 0;
const bull_flag_detector_1 = require("./bull-flag.detector");
const abcd_detector_1 = require("./abcd.detector");
const orb_detector_1 = require("./orb.detector");
const vwap_reversal_detector_1 = require("./vwap-reversal.detector");
const fallen_angel_detector_1 = require("./fallen-angel.detector");
const technical_signals_detector_1 = require("./technical-signals.detector");
class PatternSignalsDetector {
    constructor() {
        this.bullFlag = new bull_flag_detector_1.BullFlagDetector();
        this.abcd = new abcd_detector_1.AbcdDetector();
        this.orb = new orb_detector_1.OrbDetector();
        this.vwapReversal = new vwap_reversal_detector_1.VwapReversalDetector();
        this.fallenAngel = new fallen_angel_detector_1.FallenAngelDetector();
        this.technical = new technical_signals_detector_1.TechnicalSignalsDetector();
    }
    detect(ctx) {
        const patterns = [];
        const signals = [];
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
        signals.push(...this.technical.detect(ctx));
        return {
            signals,
            bullFlagDetected: bullFlagResult.detected,
            abcdDetected: abcdResult.detected,
            orbDetected: orbResult.detected,
            vwapReversalDetected: vwapReversalResult.detected,
            fallenAngelDetected: fallenAngelResult.detected,
            patterns,
        };
    }
}
exports.PatternSignalsDetector = PatternSignalsDetector;
//# sourceMappingURL=pattern-signals.detector.js.map