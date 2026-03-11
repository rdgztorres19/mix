/**
 * Per-candle indicator calculator for the collector pipeline.
 * Computes VWAP, EMA9, EMA20, ATR, HOD, LOD, session, change_pct, etc.
 * from the running candle history of each symbol.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get computeCandleRow () {
        return computeCandleRow;
    },
    get timestampToET () {
        return timestampToET;
    }
});
const ATR_PERIOD = 14;
function timestampToET(ms) {
    const d = new Date(ms);
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(d);
    const get = (type)=>parts.find((p)=>p.type === type)?.value ?? '';
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    const h = parseInt(get('hour'), 10);
    const m = parseInt(get('minute'), 10);
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return {
        date,
        time,
        minuteOfDay: h * 60 + m
    };
}
function getSession(minuteOfDay) {
    if (minuteOfDay < 570) return 'premarket'; // before 9:30
    if (minuteOfDay < 600) return 'open'; // 9:30-10:00
    if (minuteOfDay < 720) return 'morning'; // 10:00-12:00
    if (minuteOfDay < 900) return 'midday'; // 12:00-15:00
    if (minuteOfDay < 960) return 'power_hour'; // 15:00-16:00
    return 'afterhours';
}
function computeCandleRow(symbol, history, metadata) {
    const candle = history[history.length - 1];
    const n = history.length;
    const { date, time, minuteOfDay } = timestampToET(candle.t);
    // Candle index: count from 0 for today
    const candle_idx = n - 1;
    // VWAP (cumulative)
    let cumTPV = 0;
    let cumV = 0;
    for (const c of history){
        const tp = (c.h + c.l + c.c) / 3;
        cumTPV += tp * c.v;
        cumV += c.v;
    }
    const vwap = cumV > 0 ? cumTPV / cumV : candle.c;
    // EMA9 & EMA20
    const ema9 = computeEma(history.map((c)=>c.c), 9);
    const ema20 = computeEma(history.map((c)=>c.c), 20);
    // ATR (last ATR_PERIOD candles)
    const atr = computeAtr(history, ATR_PERIOD);
    // High/Low of day (running)
    let high_of_day = -Infinity;
    let low_of_day = Infinity;
    for (const c of history){
        if (c.h > high_of_day) high_of_day = c.h;
        if (c.l < low_of_day) low_of_day = c.l;
    }
    // Change % from prior close
    const change_pct_at_candle = metadata.priorClose > 0 ? (candle.c - metadata.priorClose) / metadata.priorClose : 0;
    // Change 1m, 5m, 10m
    const change_1m = n >= 2 ? (candle.c - history[n - 2].c) / Math.max(Math.abs(history[n - 2].c), 1e-6) : 0;
    const change_5m = n >= 6 ? (candle.c - history[n - 6].c) / Math.max(Math.abs(history[n - 6].c), 1e-6) : 0;
    const change_10m = n >= 11 ? (candle.c - history[n - 11].c) / Math.max(Math.abs(history[n - 11].c), 1e-6) : 0;
    // Minutes since HOD
    let hodIdx = 0;
    for(let i = 0; i < n; i++){
        if (history[i].h >= high_of_day) hodIdx = i;
    }
    const minutes_since_hod = candle_idx - hodIdx;
    const session = getSession(minuteOfDay);
    return {
        symbol: symbol.toUpperCase(),
        date,
        candle_idx,
        candle_time_et: time,
        open: candle.o,
        high: candle.h,
        low: candle.l,
        close: candle.c,
        volume: candle.v,
        atr,
        vwap,
        ema9,
        ema20,
        high_of_day,
        low_of_day,
        change_pct_at_candle,
        pre_market_high: metadata.preMarketHigh,
        session,
        shares_outstanding: metadata.sharesOutstanding,
        market_cap: metadata.marketCap,
        gap_pct: metadata.gapPct,
        premarket_volume: metadata.premarketVolume,
        change_1m,
        change_5m,
        change_10m,
        minutes_since_hod,
        original_timestamp_ms: candle.t
    };
}
function computeEma(values, period) {
    if (!values.length) return 0;
    if (values.length < period) {
        // Not enough data → simple average
        return values.reduce((s, v)=>s + v, 0) / values.length;
    }
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((s, v)=>s + v, 0) / period;
    for(let i = period; i < values.length; i++){
        ema = values[i] * k + ema * (1 - k);
    }
    return ema;
}
function computeAtr(candles, period) {
    if (candles.length < 2) return 0;
    const trs = [];
    for(let i = 1; i < candles.length; i++){
        const prev = candles[i - 1];
        const cur = candles[i];
        trs.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)));
    }
    const slice = trs.slice(-period);
    return slice.length > 0 ? slice.reduce((s, v)=>s + v, 0) / slice.length : 0;
}

//# sourceMappingURL=indicator.calculator.js.map