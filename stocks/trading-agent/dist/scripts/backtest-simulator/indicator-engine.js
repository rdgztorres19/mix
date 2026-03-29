"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "IndicatorEngine", {
    enumerable: true,
    get: function() {
        return IndicatorEngine;
    }
});
const _indicatorcalculator = require("../../collector/indicator.calculator");
const MARKET_OPEN_MINUTE = 9 * 60 + 30; // 09:30 ET
let IndicatorEngine = class IndicatorEngine {
    buildMetadata(candles, prevClose, profile) {
        // Pre-market candles: before 09:30 ET
        let preMarketHigh = 0;
        let premarketVolume = 0;
        for (const c of candles){
            const { minuteOfDay } = (0, _indicatorcalculator.timestampToET)(c.t);
            if (minuteOfDay < MARKET_OPEN_MINUTE) {
                if (c.h > preMarketHigh) preMarketHigh = c.h;
                premarketVolume += c.v;
            }
        }
        // Gap %: first candle open vs prev close
        const firstOpen = candles.length > 0 ? candles[0].o : 0;
        const gapPct = prevClose > 0 ? (firstOpen - prevClose) / prevClose * 100 : 0;
        return {
            priorClose: prevClose,
            preMarketHigh,
            sharesOutstanding: profile?.shares_outstanding ?? null,
            marketCap: profile?.market_cap ?? null,
            gapPct,
            premarketVolume
        };
    }
    buildRow(symbol, history, metadata) {
        return (0, _indicatorcalculator.computeCandleRow)(symbol, history, metadata);
    }
    buildPredictPayload(row, history) {
        const candles = history.map((c, i)=>({
                t: i,
                o: c.o,
                h: c.h,
                l: c.l,
                c: c.c,
                v: c.v
            }));
        const candleTimesEt = history.map((c)=>(0, _indicatorcalculator.timestampToET)(c.t).time);
        const candleIdxArr = history.map((_, i)=>i);
        return {
            candles,
            target_idx: history.length - 1,
            candle_times_et: candleTimesEt,
            candle_idx_arr: candleIdxArr,
            atr: row.atr ?? 0,
            high_of_day: row.high_of_day ?? 0,
            low_of_day: row.low_of_day ?? 0,
            pre_market_high: row.pre_market_high ?? 0,
            change_pct_at_candle: row.change_pct_at_candle ?? 0,
            shares_outstanding: row.shares_outstanding ?? 0,
            market_cap: row.market_cap ?? 0,
            gap_pct: row.gap_pct ?? 0,
            premarket_volume: row.premarket_volume ?? 0
        };
    }
    /**
   * Build payload sending only raw candles + metadata.
   * Python computes ALL features (no TypeScript computeCandleRow).
   * This matches eval_multiday pipeline exactly.
   */ buildRawPayload(history, metadata) {
        const candles = history.map((c, i)=>({
                t: i,
                o: c.o,
                h: c.h,
                l: c.l,
                c: c.c,
                v: c.v
            }));
        const candleTimesEt = history.map((c)=>(0, _indicatorcalculator.timestampToET)(c.t).time);
        const candleIdxArr = history.map((_, i)=>i);
        return {
            candles,
            target_idx: history.length - 1,
            candle_times_et: candleTimesEt,
            candle_idx_arr: candleIdxArr,
            atr: 0,
            high_of_day: 0,
            low_of_day: 0,
            pre_market_high: metadata.preMarketHigh ?? 0,
            change_pct_at_candle: 0,
            shares_outstanding: metadata.sharesOutstanding ?? 0,
            market_cap: metadata.marketCap ?? 0,
            gap_pct: metadata.gapPct ?? 0,
            premarket_volume: metadata.premarketVolume ?? 0
        };
    }
};

//# sourceMappingURL=indicator-engine.js.map