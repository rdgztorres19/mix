"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTrainingRow = buildTrainingRow;
const gap_feature_1 = require("./gap.feature");
const change_feature_1 = require("./change.feature");
const minutes_since_hod_feature_1 = require("./minutes-since-hod.feature");
const momentum_feature_1 = require("./momentum.feature");
const future_return_label_1 = require("./future-return.label");
const target_label_1 = require("./target.label");
const break_hod_label_1 = require("./break-hod.label");
const max_future_return_label_1 = require("./max-future-return.label");
const session_utils_1 = require("./session-utils");
const vwap_1 = require("./indicators/vwap");
const ema_1 = require("./indicators/ema");
const atr_1 = require("./indicators/atr");
function buildTrainingRow(input) {
    const { symbol, date, candles, idx, priorClose, openDay, openFirst, premarketVolume, preMarketHigh, sharesOutstanding = null, marketCap = null, } = input;
    const candle = candles[idx];
    const candlesUpToNow = candles.slice(0, idx + 1);
    const closes = candlesUpToNow.map((c) => c.c);
    const ema9 = (0, ema_1.calculateEma)(closes, 9);
    const ema20 = (0, ema_1.calculateEma)(closes, 20);
    const atr = (0, atr_1.calculateAtr)(candlesUpToNow, 14);
    const vwap = (0, vwap_1.calculateVwap)(candlesUpToNow);
    const highOfDay = Math.max(...candlesUpToNow.map((c) => c.h));
    const lowOfDay = Math.min(...candlesUpToNow.map((c) => c.l));
    const highOfDayUpToT = highOfDay;
    const changePctAtCandle = priorClose > 0 ? (candle.c - priorClose) / priorClose : 0;
    const session = (0, session_utils_1.getSessionFromTimestamp)(candle.t);
    const candleTimeEt = new Date(candle.t).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const gapPct = (0, gap_feature_1.computeGapPct)(priorClose, openFirst);
    const change = (0, change_feature_1.computeChange)(candles, idx);
    const minutesSinceHod = (0, minutes_since_hod_feature_1.computeMinutesSinceHod)(candles, idx, highOfDayUpToT);
    const momentumAcumulado = (0, momentum_feature_1.computeMomentumAcumulado)(candle.c, openDay);
    const futureReturn5m = (0, future_return_label_1.computeFutureReturn5m)(candles, idx);
    const target = (0, target_label_1.computeTarget)(futureReturn5m);
    const targetBreakHod5m = (0, break_hod_label_1.computeTargetBreakHod5m)(candles, idx, highOfDayUpToT);
    const maxFutureReturn10m = (0, max_future_return_label_1.computeMaxFutureReturn10m)(candles, idx);
    return {
        symbol: symbol.toUpperCase(),
        date,
        candle_idx: idx,
        candle_time_et: candleTimeEt,
        open: candle.o,
        high: candle.h,
        low: candle.l,
        close: candle.c,
        volume: candle.v,
        atr,
        vwap: vwap ?? candle.c,
        ema9: ema9 ?? candle.c,
        ema20: ema20 ?? candle.c,
        high_of_day: highOfDayUpToT,
        low_of_day: lowOfDay,
        change_pct_at_candle: changePctAtCandle,
        pre_market_high: preMarketHigh ?? 0,
        session,
        shares_outstanding: sharesOutstanding,
        market_cap: marketCap,
        gap_pct: gapPct,
        premarket_volume: premarketVolume,
        momentum_acumulado: momentumAcumulado,
        change_1m: change.change_1m,
        change_5m: change.change_5m,
        change_10m: change.change_10m,
        minutes_since_hod: minutesSinceHod,
        future_return_5m: futureReturn5m,
        target,
        target_break_hod_5m: targetBreakHod5m,
        max_future_return_10m: maxFutureReturn10m,
    };
}
//# sourceMappingURL=training-row-builder.js.map