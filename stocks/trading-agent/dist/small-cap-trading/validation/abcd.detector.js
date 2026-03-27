"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AbcdDetector", {
    enumerable: true,
    get: function() {
        return AbcdDetector;
    }
});
let AbcdDetector = class AbcdDetector {
    detect(candles) {
        const empty = {
            detected: false,
            name: 'ABCD',
            anchor_points: [],
            description: ''
        };
        if (candles.length < 8) return empty;
        const window = candles.slice(-this.WINDOW);
        const highs = this.findSwingHighs(window);
        const lows = this.findSwingLows(window);
        if (highs.length < 1 || lows.length < 2) return empty;
        // Walk backwards: find most recent C (swing low), then B (swing high before C), then A (swing low before B)
        for(let ci = lows.length - 1; ci >= 1; ci--){
            const cIdx = lows[ci];
            const cCandle = window[cIdx];
            // Find B: most recent swing high before C
            const bIdx = this.lastBefore(highs, cIdx);
            if (bIdx === null) continue;
            const bCandle = window[bIdx];
            // Find A: most recent swing low before B
            const aIdx = this.lastBefore(lows, bIdx);
            if (aIdx === null) continue;
            const aCandle = window[aIdx];
            // Validate: C > A (higher low)
            if (cCandle.l >= aCandle.l === false) continue; // C.low must be > A.low
            if (cCandle.l <= aCandle.l) continue;
            // Validate: B is higher than both A and C
            if (bCandle.h <= aCandle.h || bCandle.h <= cCandle.h) continue;
            // Validate: A→B is a strong move (B significantly above A)
            const abRange = bCandle.h - aCandle.l;
            if (abRange <= 0) continue;
            // B→C pullback should not exceed 100% of A→B (C > A guarantees < 100%)
            const bcRetrace = (bCandle.h - cCandle.l) / abRange;
            if (bcRetrace > 0.8) continue; // allow up to 80% retrace (commonly 38-62%)
            // Check if D is forming: price after C is moving up
            const postC = window.slice(cIdx + 1);
            const dCandle = postC.length > 0 ? postC[postC.length - 1] : null;
            const dForming = dCandle && dCandle.c > cCandle.l;
            const points = [
                {
                    label: 'A',
                    price: aCandle.l,
                    time: aCandle.t
                },
                {
                    label: 'B',
                    price: bCandle.h,
                    time: bCandle.t
                },
                {
                    label: 'C',
                    price: cCandle.l,
                    time: cCandle.t
                }
            ];
            if (dCandle && dForming) {
                points.push({
                    label: 'D',
                    price: dCandle.h,
                    time: dCandle.t
                });
            }
            return {
                detected: true,
                name: 'ABCD',
                anchor_points: points,
                description: `ABCD: A=$${aCandle.l.toFixed(2)} → B=$${bCandle.h.toFixed(2)} → C=$${cCandle.l.toFixed(2)} (${(bcRetrace * 100).toFixed(0)}% retrace)${dForming ? ' → D forming' : ''}`
            };
        }
        return empty;
    }
    /** 3-candle fractal swing high: candle with higher high than both neighbors. */ findSwingHighs(candles) {
        const result = [];
        for(let i = 1; i < candles.length - 1; i++){
            if (candles[i].h > candles[i - 1].h && candles[i].h > candles[i + 1].h) {
                result.push(i);
            }
        }
        return result;
    }
    /** 3-candle fractal swing low: candle with lower low than both neighbors. */ findSwingLows(candles) {
        const result = [];
        for(let i = 1; i < candles.length - 1; i++){
            if (candles[i].l < candles[i - 1].l && candles[i].l < candles[i + 1].l) {
                result.push(i);
            }
        }
        return result;
    }
    /** Return the last index in `arr` that is strictly less than `before`. */ lastBefore(arr, before) {
        for(let i = arr.length - 1; i >= 0; i--){
            if (arr[i] < before) return arr[i];
        }
        return null;
    }
    constructor(){
        this.WINDOW = 20;
    }
};

//# sourceMappingURL=abcd.detector.js.map