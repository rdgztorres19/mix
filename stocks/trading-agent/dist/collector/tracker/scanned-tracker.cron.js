"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ScannedTrackerCron", {
    enumerable: true,
    get: function() {
        return ScannedTrackerCron;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _scannedtrackerservice = require("./scanned-tracker.service");
const _alpacadatasource = require("../../scanner/datasource/alpaca-datasource");
const _emacalculator = require("../../small-cap-trading/indicators/ema.calculator");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let ScannedTrackerCron = class ScannedTrackerCron {
    async runScannerTrackerRefresh() {
        if (!this.isWithinTrackingHours()) {
            return;
        }
        const trackedSymbols = this.trackerService.getTrackedSymbols();
        if (trackedSymbols.length === 0) {
            return;
        }
        this.evictOldCachesIfNeeded();
        this.logger.log(`Refreshing tracking metrics for ${trackedSymbols.length} symbols...`);
        for (const symbolData of trackedSymbols){
            await this.refreshSymbolSafely(symbolData);
            await this.delay(ScannedTrackerCron.REQUEST_DELAY_MS);
        }
    }
    async refreshSymbolSafely(symbolData) {
        try {
            await this.refreshSymbolMetrics(symbolData);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to refresh metrics for ${symbolData.symbol}: ${message}`);
        }
    }
    async refreshSymbolMetrics(symbolData) {
        const nowEt = this.getNowInEasternTime();
        const tradingDay = this.toEasternDateString(nowEt);
        const todayPremarketStartMs = this.createEasternTimeBoundary(nowEt, ScannedTrackerCron.PREMARKET_START_HOUR_ET, 0).getTime();
        const marketOpenMs = this.createEasternTimeBoundary(nowEt, ScannedTrackerCron.MARKET_OPEN_HOUR_ET, ScannedTrackerCron.MARKET_OPEN_MINUTE_ET).getTime();
        const frozenResult = await this.getOrComputeFrozenMetrics(symbolData.symbol, tradingDay, nowEt, todayPremarketStartMs, marketOpenMs);
        /**
     * Si el cálculo frozen vino de un fetch largo, reutilizamos esas velas
     * para evitar otra llamada live innecesaria.
     */ if (frozenResult.sourceCandles && frozenResult.sourceCandles.length > 0) {
            this.seedLiveBarsCacheFromCandles(symbolData.symbol, frozenResult.sourceCandles);
        }
        const liveCandles = await this.getOrFetchLiveCandles(symbolData.symbol, nowEt);
        if (liveCandles.length === 0) {
            return;
        }
        const liveMetrics = this.calculateLiveMetrics(liveCandles);
        const passesPreFilter = this.passesPreFilter({
            close: liveMetrics.close,
            ema9: liveMetrics.ema9,
            premarketDollarVolume: frozenResult.frozen.premarketDollarVolume
        });
        await this.trackerService.updateCalculatedMetrics(symbolData.symbol, {
            premarket_volume: frozenResult.frozen.premarketVolume ?? 0,
            premarket_dollar_volume: frozenResult.frozen.premarketDollarVolume,
            volume: liveMetrics.volume,
            dollar_volume: liveMetrics.dollarVolume,
            close: liveMetrics.close,
            ema9: liveMetrics.ema9,
            gap_pct: frozenResult.frozen.gapPct ?? 0,
            passes_pre_filter: passesPreFilter
        });
    }
    async getOrComputeFrozenMetrics(symbol, tradingDay, nowEt, todayPremarketStartMs, marketOpenMs) {
        const cacheKey = this.getFrozenCacheKey(symbol, tradingDay);
        const cached = this.frozenMetricsCache.get(cacheKey);
        const nowMs = Date.now();
        const premarketEnded = this.hasPremarketEnded(nowEt);
        if (cached) {
            if (cached.isFinalized) {
                return {
                    frozen: cached
                };
            }
            const cacheStillFresh = nowMs - cached.fetchedAt < ScannedTrackerCron.PREMARKET_FROZEN_TTL_MS;
            if (!premarketEnded && cacheStillFresh) {
                return {
                    frozen: cached
                };
            }
        }
        const longCandles = await this.fetchLongRangeCandles(symbol, nowEt);
        if (longCandles.length === 0) {
            return {
                frozen: cached ?? this.createEmptyFrozenMetrics(tradingDay, premarketEnded)
            };
        }
        const computed = this.computeFrozenMetricsFromCandles(tradingDay, longCandles, todayPremarketStartMs, marketOpenMs, premarketEnded);
        this.frozenMetricsCache.set(cacheKey, computed);
        return {
            frozen: computed,
            sourceCandles: longCandles
        };
    }
    computeFrozenMetricsFromCandles(tradingDay, candles, todayPremarketStartMs, marketOpenMs, isFinalized) {
        const priorClose = this.getPreviousRegularClose(candles, todayPremarketStartMs);
        const premarketCandles = candles.filter((candle)=>candle.t >= todayPremarketStartMs && candle.t < marketOpenMs);
        const referencePremarketCandle = premarketCandles[premarketCandles.length - 1] ?? null;
        const referencePrice = referencePremarketCandle?.c ?? candles[candles.length - 1]?.c ?? 0;
        const premarketVolume = this.sumVolume(premarketCandles);
        const premarketDollarVolume = this.safeMultiply(referencePrice, premarketVolume);
        const gapPct = this.calculateGapPercent(referencePrice, priorClose ?? 0);
        return {
            tradingDay,
            priorClose,
            gapPct,
            premarketVolume,
            premarketDollarVolume,
            isFinalized,
            fetchedAt: Date.now()
        };
    }
    /**
   * Busca el previous REGULAR close.
   * Toma la última vela antes de 4:00 AM ET de hoy,
   * pero intenta preferir una vela de sesión regular previa
   * (<= 16:00 ET del último día hábil anterior).
   *
   * Si no puede, cae en la última vela disponible anterior.
   */ getPreviousRegularClose(candles, todayPremarketStartMs) {
        const previousDayCandles = candles.filter((c)=>c.t < todayPremarketStartMs);
        if (previousDayCandles.length === 0) {
            return null;
        }
        const groupedByDate = new Map();
        for (const candle of previousDayCandles){
            const dateKey = this.toEasternDateString(new Date(candle.t));
            const list = groupedByDate.get(dateKey) ?? [];
            list.push(candle);
            groupedByDate.set(dateKey, list);
        }
        const datesDesc = Array.from(groupedByDate.keys()).sort().reverse();
        for (const dateKey of datesDesc){
            const dayCandles = (groupedByDate.get(dateKey) ?? []).sort((a, b)=>a.t - b.t);
            const regularSessionCandles = dayCandles.filter((candle)=>this.isWithinRegularHoursEt(candle.t));
            if (regularSessionCandles.length > 0) {
                return regularSessionCandles[regularSessionCandles.length - 1].c;
            }
        }
        return previousDayCandles[previousDayCandles.length - 1].c;
    }
    async getOrFetchLiveCandles(symbol, nowEt) {
        const cacheKey = this.getLiveCacheKey(symbol);
        const cached = this.liveBarsCache.get(cacheKey);
        if (cached && Date.now() - cached.fetchedAt < ScannedTrackerCron.LIVE_BARS_TTL_MS) {
            return cached.candles;
        }
        const candles = await this.fetchShortRangeCandles(symbol, nowEt);
        if (candles.length > 0) {
            this.liveBarsCache.set(cacheKey, {
                symbol,
                candles,
                fetchedAt: Date.now(),
                rangeStart: this.buildShortFetchRange(nowEt).start,
                rangeEnd: this.buildShortFetchRange(nowEt).end
            });
        }
        return candles;
    }
    calculateLiveMetrics(candles) {
        const latestCandle = candles[candles.length - 1];
        const close = latestCandle.c;
        const volume = latestCandle.v;
        const ema9 = _emacalculator.EmaCalculator.calculate(candles.map((c)=>c.c), ScannedTrackerCron.EMA_PERIOD);
        return {
            close,
            volume,
            dollarVolume: this.safeMultiply(close, volume),
            ema9
        };
    }
    async fetchLongRangeCandles(symbol, nowEt) {
        const inFlight = this.inFlightLongFetches.get(symbol);
        if (inFlight) {
            return inFlight;
        }
        const promise = this.doFetchLongRangeCandles(symbol, nowEt);
        this.inFlightLongFetches.set(symbol, promise);
        try {
            return await promise;
        } finally{
            this.inFlightLongFetches.delete(symbol);
        }
    }
    async doFetchLongRangeCandles(symbol, nowEt) {
        const range = this.buildLongFetchRange(nowEt);
        const response = await this.alpacaDataSource.fetchBarsFromAlpacaDirect({
            symbol,
            timeframe: '1Min',
            start: range.start,
            end: range.end,
            feed: 'sip',
            limit: 10000
        });
        const bars = response?.bars ?? [];
        if (bars.length === 0) {
            this.logger.warn(`No long-range bars returned for ${symbol} between ${range.start} and ${range.end}`);
            return [];
        }
        return bars.map((bar)=>this.mapAlpacaBarToCandle(bar)).filter((candle)=>this.isValidCandle(candle)).sort((a, b)=>a.t - b.t);
    }
    async fetchShortRangeCandles(symbol, nowEt) {
        const inFlight = this.inFlightLiveFetches.get(symbol);
        if (inFlight) {
            return inFlight;
        }
        const promise = this.doFetchShortRangeCandles(symbol, nowEt);
        this.inFlightLiveFetches.set(symbol, promise);
        try {
            return await promise;
        } finally{
            this.inFlightLiveFetches.delete(symbol);
        }
    }
    async doFetchShortRangeCandles(symbol, nowEt) {
        const range = this.buildShortFetchRange(nowEt);
        const response = await this.alpacaDataSource.fetchBarsFromAlpacaDirect({
            symbol,
            timeframe: '1Min',
            start: range.start,
            end: range.end,
            feed: 'sip',
            limit: 120
        });
        const bars = response?.bars ?? [];
        if (bars.length === 0) {
            //this.logger.warn(`No live bars returned for ${symbol} between ${range.start} and ${range.end}`);
            return [];
        }
        return bars.map((bar)=>this.mapAlpacaBarToCandle(bar)).filter((candle)=>this.isValidCandle(candle)).sort((a, b)=>a.t - b.t);
    }
    seedLiveBarsCacheFromCandles(symbol, sourceCandles) {
        const recentCutoffMs = Date.now() - ScannedTrackerCron.LIVE_LOOKBACK_MINUTES * 60_000;
        const recentCandles = sourceCandles.filter((candle)=>candle.t >= recentCutoffMs);
        if (recentCandles.length === 0) {
            return;
        }
        this.liveBarsCache.set(this.getLiveCacheKey(symbol), {
            symbol,
            candles: recentCandles.sort((a, b)=>a.t - b.t),
            fetchedAt: Date.now(),
            rangeStart: new Date(recentCandles[0].t).toISOString(),
            rangeEnd: new Date(recentCandles[recentCandles.length - 1].t).toISOString()
        });
    }
    buildLongFetchRange(nowEt) {
        const startEt = new Date(nowEt);
        startEt.setDate(startEt.getDate() - ScannedTrackerCron.LONG_LOOKBACK_DAYS);
        startEt.setHours(0, 0, 0, 0);
        return {
            start: this.toIsoUtcString(startEt),
            end: this.toIsoUtcString(nowEt)
        };
    }
    buildShortFetchRange(nowEt) {
        const start = new Date(nowEt.getTime() - ScannedTrackerCron.LIVE_LOOKBACK_MINUTES * 60_000);
        return {
            start: this.toIsoUtcString(start),
            end: this.toIsoUtcString(nowEt)
        };
    }
    mapAlpacaBarToCandle(bar) {
        return {
            t: this.toBarTimestampMs(bar.t),
            o: Number(bar.o ?? 0),
            h: Number(bar.h ?? 0),
            l: Number(bar.l ?? 0),
            c: Number(bar.c ?? 0),
            v: Number(bar.v ?? 0)
        };
    }
    isValidCandle(candle) {
        return Number.isFinite(candle.t) && Number.isFinite(candle.o) && Number.isFinite(candle.h) && Number.isFinite(candle.l) && Number.isFinite(candle.c) && Number.isFinite(candle.v);
    }
    toBarTimestampMs(value) {
        if (typeof value === 'number') {
            return value > 9999999999 ? value : value * 1000;
        }
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    calculateGapPercent(currentPrice, priorClose) {
        if (!Number.isFinite(currentPrice) || !Number.isFinite(priorClose) || priorClose <= 0) {
            return 0;
        }
        return (currentPrice - priorClose) / priorClose * 100;
    }
    safeMultiply(a, b) {
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            return null;
        }
        const result = a * b;
        return Number.isFinite(result) ? result : null;
    }
    sumVolume(candles) {
        return candles.reduce((total, candle)=>total + candle.v, 0);
    }
    passesPreFilter(params) {
        const { close, ema9, premarketDollarVolume } = params;
        return premarketDollarVolume !== null && Number.isFinite(close) && Number.isFinite(ema9) && premarketDollarVolume <= ScannedTrackerCron.PREMARKET_DOLLAR_VOLUME_THRESHOLD && close > ema9;
    }
    hasPremarketEnded(nowEt) {
        const marketOpen = this.createEasternTimeBoundary(nowEt, ScannedTrackerCron.MARKET_OPEN_HOUR_ET, ScannedTrackerCron.MARKET_OPEN_MINUTE_ET);
        return nowEt.getTime() >= marketOpen.getTime();
    }
    isWithinTrackingHours() {
        const nowEt = this.getNowInEasternTime();
        const hour = nowEt.getHours();
        return hour >= ScannedTrackerCron.TRACKING_START_HOUR_ET && hour < ScannedTrackerCron.TRACKING_END_HOUR_ET;
    }
    isWithinRegularHoursEt(timestampMs) {
        const dateEt = new Date(new Date(timestampMs).toLocaleString('en-US', {
            timeZone: ScannedTrackerCron.NEW_YORK_TIMEZONE
        }));
        const hours = dateEt.getHours();
        const minutes = dateEt.getMinutes();
        const totalMinutes = hours * 60 + minutes;
        const regularOpenMinutes = 9 * 60 + 30;
        const regularCloseMinutes = 16 * 60;
        return totalMinutes >= regularOpenMinutes && totalMinutes <= regularCloseMinutes;
    }
    createEmptyFrozenMetrics(tradingDay, isFinalized) {
        return {
            tradingDay,
            priorClose: null,
            gapPct: null,
            premarketVolume: null,
            premarketDollarVolume: null,
            isFinalized,
            fetchedAt: Date.now()
        };
    }
    getFrozenCacheKey(symbol, tradingDay) {
        return `${symbol}:${tradingDay}`;
    }
    getLiveCacheKey(symbol) {
        return symbol;
    }
    evictOldCachesIfNeeded() {
        const todayEt = this.toEasternDateString(this.getNowInEasternTime());
        for (const [key, value] of this.frozenMetricsCache.entries()){
            if (value.tradingDay !== todayEt) {
                this.frozenMetricsCache.delete(key);
            }
        }
        const now = Date.now();
        for (const [key, value] of this.liveBarsCache.entries()){
            if (now - value.fetchedAt > ScannedTrackerCron.LIVE_BARS_TTL_MS * 4) {
                this.liveBarsCache.delete(key);
            }
        }
    }
    getNowInEasternTime() {
        return new Date(new Date().toLocaleString('en-US', {
            timeZone: ScannedTrackerCron.NEW_YORK_TIMEZONE
        }));
    }
    createEasternTimeBoundary(baseDate, hour, minute) {
        const boundary = new Date(baseDate);
        boundary.setHours(hour, minute, 0, 0);
        return boundary;
    }
    toEasternDateString(date) {
        return date.toLocaleDateString('en-CA', {
            timeZone: ScannedTrackerCron.NEW_YORK_TIMEZONE
        });
    }
    toIsoUtcString(date) {
        return date.toISOString().slice(0, 19) + 'Z';
    }
    async delay(ms) {
        await new Promise((resolve)=>setTimeout(resolve, ms));
    }
    constructor(trackerService, alpacaDataSource){
        this.trackerService = trackerService;
        this.alpacaDataSource = alpacaDataSource;
        this.logger = new _common.Logger(ScannedTrackerCron.name);
        this.frozenMetricsCache = new Map();
        this.liveBarsCache = new Map();
        /**
   * Evita requests duplicados simultáneos por símbolo.
   */ this.inFlightLongFetches = new Map();
        this.inFlightLiveFetches = new Map();
    }
};
ScannedTrackerCron.NEW_YORK_TIMEZONE = 'America/New_York';
ScannedTrackerCron.TRACKING_START_HOUR_ET = 4;
ScannedTrackerCron.TRACKING_END_HOUR_ET = 12;
ScannedTrackerCron.PREMARKET_START_HOUR_ET = 4;
ScannedTrackerCron.MARKET_OPEN_HOUR_ET = 9;
ScannedTrackerCron.MARKET_OPEN_MINUTE_ET = 30;
ScannedTrackerCron.EMA_PERIOD = 9;
ScannedTrackerCron.REQUEST_DELAY_MS = 200;
ScannedTrackerCron.PREMARKET_DOLLAR_VOLUME_THRESHOLD = 407568.983475;
/**
   * Rango largo para encontrar prior close real
   * incluso con fines de semana / feriados.
   */ ScannedTrackerCron.LONG_LOOKBACK_DAYS = 7;
/**
   * Rango corto para live bars.
   * Debe cubrir al menos EMA9 cómodamente.
   */ ScannedTrackerCron.LIVE_LOOKBACK_MINUTES = 45;
/**
   * Cache live: si el cron corre cada minuto,
   * 45s-60s evita múltiples calls innecesarias.
   */ ScannedTrackerCron.LIVE_BARS_TTL_MS = 45_000;
/**
   * Antes de 9:30, premarket/gap todavía cambian.
   * No hace falta recalcularlos cada minuto exacto.
   */ ScannedTrackerCron.PREMARKET_FROZEN_TTL_MS = 120_000;
_ts_decorate([
    (0, _schedule.Cron)('* * * * 1-5'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], ScannedTrackerCron.prototype, "runScannerTrackerRefresh", null);
ScannedTrackerCron = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _scannedtrackerservice.ScannedTrackerService === "undefined" ? Object : _scannedtrackerservice.ScannedTrackerService,
        typeof _alpacadatasource.AlpacaDataSource === "undefined" ? Object : _alpacadatasource.AlpacaDataSource
    ])
], ScannedTrackerCron);

//# sourceMappingURL=scanned-tracker.cron.js.map