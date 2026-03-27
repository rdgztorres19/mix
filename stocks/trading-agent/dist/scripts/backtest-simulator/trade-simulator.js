"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "TradeSimulator", {
    enumerable: true,
    get: function() {
        return TradeSimulator;
    }
});
const _indicatorcalculator = require("../../collector/indicator.calculator");
let TradeSimulator = class TradeSimulator {
    /**
   * Evaluate a trade signal by looking ahead in the candle history.
   * Replicates the logic from PredictorService.computeTpSlExit().
   */ evaluate(allCandles, entryIdx) {
        const entryCandle = allCandles[entryIdx];
        if (!entryCandle) {
            return {
                result: 'neutral',
                entryPrice: 0,
                pnlPct: 0
            };
        }
        const entryPrice = entryCandle.c;
        if (entryPrice <= 0) {
            return {
                result: 'neutral',
                entryPrice,
                pnlPct: 0
            };
        }
        const tpDec = this.targetPct / 100;
        const slDec = this.stopLossPct / 100;
        const levelUp = entryPrice * (1 + tpDec);
        const levelDown = entryPrice * (1 - slDec);
        let prevClose = entryPrice;
        const n = Math.min(this.lookAhead, allCandles.length - entryIdx - 1);
        for(let j = 1; j <= n; j++){
            const c = allCandles[entryIdx + j];
            if (!c) break;
            const openJ = c.o;
            const highJ = c.h;
            const lowJ = c.l;
            const closeJ = c.c;
            // Gap up through TP
            if (prevClose < openJ && prevClose < levelUp && levelUp < openJ) {
                return this.buildResult('win', entryPrice, levelUp, c);
            }
            // Gap down through SL
            if (prevClose > openJ && openJ < levelDown && levelDown < prevClose) {
                return this.buildResult('loss', entryPrice, levelDown, c);
            }
            const touchUp = highJ >= levelUp;
            const touchDown = lowJ <= levelDown;
            if (touchUp && touchDown) {
                // Both hit in same candle — use candle color heuristic (same as predictor.service.ts)
                const hit = closeJ >= openJ ? 'loss' : 'win';
                const price = closeJ >= openJ ? levelDown : levelUp;
                return this.buildResult(hit, entryPrice, price, c);
            }
            if (touchUp) return this.buildResult('win', entryPrice, levelUp, c);
            if (touchDown) return this.buildResult('loss', entryPrice, levelDown, c);
            prevClose = closeJ;
        }
        // Timeout — neither TP nor SL hit within lookAhead candles
        return {
            result: 'neutral',
            entryPrice,
            pnlPct: 0
        };
    }
    buildResult(result, entryPrice, exitPrice, candle) {
        const pnlPct = (exitPrice - entryPrice) / entryPrice * 100;
        return {
            result,
            entryPrice,
            exitPrice,
            exitMinute: (0, _indicatorcalculator.timestampToET)(candle.t).time,
            pnlPct
        };
    }
    constructor(targetPct, stopLossPct, lookAhead = 60){
        this.targetPct = targetPct;
        this.stopLossPct = stopLossPct;
        this.lookAhead = lookAhead;
    }
};

//# sourceMappingURL=trade-simulator.js.map