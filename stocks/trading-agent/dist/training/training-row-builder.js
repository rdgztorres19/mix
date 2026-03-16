/**
 * Training row builder.
 * Duplicated from stock-training/src/csv/csv-row-builder.ts - keep in sync for consistent features.
 * Adapted to output MySQL CandleRow format compatible with training_1m table.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "buildTrainingRow", {
    enumerable: true,
    get: function() {
        return buildTrainingRow;
    }
});
const _gapfeature = require("./gap.feature");
const _changefeature = require("./change.feature");
const _minutessincehodfeature = require("./minutes-since-hod.feature");
const _momentumfeature = require("./momentum.feature");
const _futurereturnlabel = require("./future-return.label");
const _targetlabel = require("./target.label");
const _breakhodlabel = require("./break-hod.label");
const _maxfuturereturnlabel = require("./max-future-return.label");
const _sessionutils = require("./session-utils");
const _vwap = require("./indicators/vwap");
const _ema = require("./indicators/ema");
const _atr = require("./indicators/atr");
function buildTrainingRow(input) {
    const { symbol, date, candles, idx, priorClose, openDay, openFirst, premarketVolume, preMarketHigh, sharesOutstanding = null, marketCap = null } = input;
    const candle = candles[idx];
    const candlesUpToNow = candles.slice(0, idx + 1);
    // Indicators (same logic as build-training-csv)
    const closes = candlesUpToNow.map((c)=>c.c);
    const ema9 = (0, _ema.calculateEma)(closes, 9);
    const ema20 = (0, _ema.calculateEma)(closes, 20);
    const atr = (0, _atr.calculateAtr)(candlesUpToNow, 14);
    const vwap = (0, _vwap.calculateVwap)(candlesUpToNow);
    const highOfDay = Math.max(...candlesUpToNow.map((c)=>c.h));
    const lowOfDay = Math.min(...candlesUpToNow.map((c)=>c.l));
    const highOfDayUpToT = highOfDay;
    const changePctAtCandle = priorClose > 0 ? (candle.c - priorClose) / priorClose : 0;
    const session = (0, _sessionutils.getSessionFromTimestamp)(candle.t);
    const candleTimeEt = new Date(candle.t).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const gapPct = (0, _gapfeature.computeGapPct)(priorClose, openFirst);
    const change = (0, _changefeature.computeChange)(candles, idx);
    const minutesSinceHod = (0, _minutessincehodfeature.computeMinutesSinceHod)(candles, idx, highOfDayUpToT);
    const momentumAcumulado = (0, _momentumfeature.computeMomentumAcumulado)(candle.c, openDay);
    const futureReturn5m = (0, _futurereturnlabel.computeFutureReturn5m)(candles, idx);
    const target = (0, _targetlabel.computeTarget)(futureReturn5m);
    const targetBreakHod5m = (0, _breakhodlabel.computeTargetBreakHod5m)(candles, idx, highOfDayUpToT);
    const maxFutureReturn10m = (0, _maxfuturereturnlabel.computeMaxFutureReturn10m)(candles, idx);
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
        max_future_return_10m: maxFutureReturn10m
    };
}

//# sourceMappingURL=training-row-builder.js.map