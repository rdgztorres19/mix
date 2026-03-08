"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BullFlagDetector = void 0;
class BullFlagDetector {
    constructor() {
        this.WINDOW = 10;
        this.MIN_POLE = 3;
        this.MIN_FLAG = 2;
        this.MAX_RETRACE_PCT = 50;
    }
    detect(candles) {
        const empty = { detected: false, name: 'BULL_FLAG', anchor_points: [], description: '' };
        if (candles.length < this.MIN_POLE + this.MIN_FLAG)
            return empty;
        const window = candles.slice(-this.WINDOW);
        for (let flagEnd = window.length - 1; flagEnd >= this.MIN_POLE + this.MIN_FLAG - 1; flagEnd--) {
            for (let splitIdx = flagEnd - this.MIN_FLAG + 1; splitIdx >= this.MIN_POLE; splitIdx--) {
                const poleCandles = window.slice(splitIdx - this.MIN_POLE, splitIdx);
                const flagCandles = window.slice(splitIdx, flagEnd + 1);
                if (!this.isValidPole(poleCandles) || !this.isValidFlag(flagCandles))
                    continue;
                const poleStart = poleCandles[0].o;
                const poleHigh = Math.max(...poleCandles.map((c) => c.h));
                const flagLow = Math.min(...flagCandles.map((c) => c.l));
                const poleRange = poleHigh - poleStart;
                if (poleRange <= 0)
                    continue;
                const retracePct = ((poleHigh - flagLow) / poleRange) * 100;
                if (retracePct >= this.MAX_RETRACE_PCT)
                    continue;
                const avgPoleVol = poleCandles.reduce((s, c) => s + c.v, 0) / poleCandles.length;
                const avgFlagVol = flagCandles.reduce((s, c) => s + c.v, 0) / flagCandles.length;
                const volumeDecreasing = avgFlagVol < avgPoleVol;
                return {
                    detected: true,
                    name: 'BULL_FLAG',
                    anchor_points: [
                        { label: 'PoleStart', price: poleStart, time: poleCandles[0].t },
                        { label: 'PoleHigh', price: poleHigh, time: poleCandles[poleCandles.length - 1].t },
                        { label: 'FlagLow', price: flagLow, time: flagCandles[flagCandles.length - 1].t },
                    ],
                    description: `Bull Flag: ${retracePct.toFixed(0)}% retrace${volumeDecreasing ? ', vol decreasing' : ''} (pole ${poleCandles.length} candles, flag ${flagCandles.length} candles)`,
                };
            }
        }
        return empty;
    }
    isValidPole(candles) {
        if (candles.length < this.MIN_POLE)
            return false;
        return candles.every((c) => c.c > c.o);
    }
    isValidFlag(flagCandles) {
        if (flagCandles.length < this.MIN_FLAG)
            return false;
        return flagCandles.every((c) => c.c < c.o);
    }
}
exports.BullFlagDetector = BullFlagDetector;
//# sourceMappingURL=bull-flag.detector.js.map