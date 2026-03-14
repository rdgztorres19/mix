"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AlpacaDataSource_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlpacaDataSource = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importStar(require("axios"));
const config_1 = require("@nestjs/config");
const small_cap_trading_1 = require("../../small-cap-trading");
let AlpacaDataSource = AlpacaDataSource_1 = class AlpacaDataSource {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(AlpacaDataSource_1.name);
        this.alpacaBaseUrl = 'https://data.alpaca.markets/v2/stocks';
        this.maxRetries = 3;
        this.requestTimeoutMs = 10000;
        this.cache = new Map();
        this.alpacaKeyId = configService.get('ALPACA_KEY_ID', 'PKBLVB6V5QWCSU2TLPHJ') || 'PKBLVB6V5QWCSU2TLPHJ';
        this.alpacaSecretKey = configService.get('ALPACA_SECRET_KEY', 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG') || 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG';
        this.logger.log('✅ AlpacaDataSource initialized with premium SIP feed (MoMo fallback disabled)');
    }
    async getStockSnapshot(ticker, options) {
        ticker = ticker.toUpperCase();
        try {
            const timeframe = options?.timeframe ?? '5m';
            const cutoffMs = options?.cutoffMs;
            const dateStr = options?.date ?? this.getTodayET();
            this.logger.log(`🎯 Fetching Alpaca snapshot for ${ticker} | ${timeframe}` +
                (cutoffMs ? ` [SIMULATION cutoff: ${new Date(cutoffMs).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET]` : ''));
            let bars = await this.fetchBarWithRetries(ticker, dateStr);
            if (!bars || bars.length === 0) {
                this.logger.warn(`⚠️ No data available from Alpaca for ${ticker} - returning empty snapshot`);
                this.logger.debug(`MoMo fallback is DISABLED - relying on 61s historical fallback only`);
                return this.emptySnapshot(ticker);
            }
            this.logger.debug(`🔍 Raw Alpaca bars sample for ${ticker}: ${JSON.stringify(bars.slice(0, 2))}`);
            const candles1m = bars.map((bar) => {
                const timestampMs = this.parseAlpacaTimestamp(bar.t);
                if (timestampMs === null) {
                    this.logger.warn(`⚠️ Invalid/missing timestamp in bar for ${ticker}: ${JSON.stringify(bar)}`);
                }
                return {
                    o: bar.o,
                    h: bar.h,
                    l: bar.l,
                    c: bar.c,
                    v: bar.v,
                    t: timestampMs,
                };
            });
            this.logger.debug(`🔍 Converted candles sample for ${ticker}: ${JSON.stringify(candles1m.slice(0, 2))}`);
            const validCandles = candles1m.filter((c) => typeof c.t === 'number' && Number.isFinite(c.t));
            this.logger.log(`📊 ${ticker}: ${candles1m.length} candles total, ${validCandles.length} with valid numeric timestamps`);
            if (validCandles.length === 0) {
                this.logger.warn(`⚠️ No valid candles after timestamp filtering for ${ticker}`);
                return this.emptySnapshot(ticker);
            }
            let filtered = validCandles;
            if (cutoffMs) {
                filtered = validCandles.filter((c) => c.t && c.t <= cutoffMs);
                if (filtered.length === 0) {
                    return this.emptySnapshot(ticker);
                }
            }
            const candles5m = this.aggregate1mTo5m(filtered);
            const candlesForMetrics = timeframe === '1m' ? filtered : candles5m;
            const latest = candlesForMetrics[candlesForMetrics.length - 1];
            const price = latest.c;
            const high_of_day = Math.max(...filtered.map((c) => c.h));
            const low_of_day = Math.min(...filtered.map((c) => c.l));
            const volume = filtered.reduce((sum, c) => sum + c.v, 0);
            const avg_volume = this.estimateAvgVolume(bars);
            const relative_volume = avg_volume > 0 ? volume / avg_volume : 0;
            const vwap = small_cap_trading_1.VwapCalculator.calculate(candlesForMetrics);
            const vwap_line = small_cap_trading_1.VwapCalculator.calculateLine(candlesForMetrics);
            const closes = candlesForMetrics.map((c) => c.c);
            const ema9 = small_cap_trading_1.EmaCalculator.calculate(closes, 9);
            const ema20 = small_cap_trading_1.EmaCalculator.calculate(closes, 20);
            const atr = small_cap_trading_1.AtrCalculator.calculate(candlesForMetrics, 14);
            const marketOpenPrice = validCandles.length > 0 ? validCandles[0].o : price;
            const change_pct = marketOpenPrice > 0 ? (price - marketOpenPrice) / marketOpenPrice : 0;
            const pre_market_high = null;
            this.logger.log(`✅ Alpaca: ${ticker} fetched ${bars.length} bars successfully`);
            return {
                ticker,
                price,
                vwap: vwap > 0 ? vwap : null,
                vwap_line,
                ema9: ema9 != null && ema9 > 0 ? ema9 : null,
                ema20: ema20 != null && ema20 > 0 ? ema20 : null,
                volume,
                avg_volume,
                relative_volume,
                change_pct,
                pre_market_high,
                candles_1min: filtered,
                candles_5min: candles5m,
                atr,
                high_of_day,
                low_of_day,
            };
        }
        catch (err) {
            this.logger.error(`❌ Alpaca datasource failed: ${err instanceof Error ? err.message : String(err)}`);
            this.logger.debug(`Error: ${err}`);
            this.logger.warn(`⚠️ ${ticker} data unavailable from Alpaca - returning empty snapshot (MoMo disabled)`);
            return this.emptySnapshot(ticker);
        }
    }
    async fetchBarWithRetries(ticker, dateStr, attempt = 1) {
        const cacheKey = `${ticker}:${dateStr}`;
        if (this.cache.has(cacheKey)) {
            this.logger.debug(`💵 Cache hit for ${ticker} on ${dateStr}`);
            return this.cache.get(cacheKey);
        }
        try {
            const bars = await this.fetchBarsFromAlpaca(ticker, dateStr);
            this.cache.set(cacheKey, bars);
            this.logger.debug(`💾 Cached ${bars.length} bars for ${ticker}:${dateStr}`);
            return bars;
        }
        catch (err) {
            const errMsg = err instanceof axios_1.AxiosError ? err.message : String(err);
            this.logger.warn(`🔄 Alpaca fetch attempt ${attempt}/${this.maxRetries} failed for ${ticker}: ${errMsg}`);
            if (attempt < this.maxRetries) {
                const delayMs = Math.pow(2, attempt - 1) * 1000;
                this.logger.debug(`⏳ Retrying in ${delayMs}ms...`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                return this.fetchBarWithRetries(ticker, dateStr, attempt + 1);
            }
            throw err;
        }
    }
    async fetchBarsFromAlpaca(ticker, dateStr) {
        const url = `${this.alpacaBaseUrl}/${ticker}/bars`;
        const params = {
            feed: 'sip',
            timeframe: '1Min',
            start: `${dateStr}T00:00:00Z`,
            end: `${dateStr}T23:59:59Z`,
            limit: '10000',
        };
        const headers = {
            'APCA-API-KEY-ID': this.alpacaKeyId,
            'APCA-API-SECRET-KEY': this.alpacaSecretKey,
        };
        this.logger.debug(`📡 Fetching from Alpaca: ${url} with feed=sip`);
        const response = await axios_1.default.get(url, {
            params,
            headers,
            timeout: this.requestTimeoutMs,
        });
        this.logger.debug(`📈 Alpaca response status: ${response.status} for ${ticker}`);
        this.logger.debug(`📈 Response data keys: ${JSON.stringify(Object.keys(response.data || {}))}`);
        if (response.data?.bars) {
            this.logger.debug(`📈 Response bars type: ${Array.isArray(response.data.bars) ? 'Array' : 'Object'}, length: ${response.data.bars.length || Object.keys(response.data.bars).length}`);
            if (Array.isArray(response.data.bars)) {
                this.logger.debug(`📈 Found ${response.data.bars.length} bars for ${ticker} (Array format)`);
            }
            else {
                this.logger.debug(`📈 Response bars keys: ${JSON.stringify(Object.keys(response.data.bars))}`);
                if (response.data.bars[ticker]) {
                    this.logger.debug(`📈 Found bars for ${ticker}: ${response.data.bars[ticker].length} bars`);
                }
                else {
                    this.logger.warn(`⚠️ No bars found for ${ticker} in response. Available symbols: ${JSON.stringify(Object.keys(response.data.bars))}`);
                }
            }
        }
        else {
            this.logger.warn(`⚠️ No 'bars' property in Alpaca response for ${ticker}. Response: ${JSON.stringify(response.data)}`);
        }
        let bars;
        if (!response.data || !response.data.bars) {
            throw new Error(`No bar data in Alpaca response for ${ticker}`);
        }
        if (Array.isArray(response.data.bars)) {
            bars = response.data.bars;
        }
        else {
            bars = response.data.bars[ticker];
        }
        if (!bars || (Array.isArray(bars) && bars.length === 0)) {
            throw new Error(`No bar data in Alpaca response for ${ticker}`);
        }
        if (!Array.isArray(bars)) {
            throw new Error(`Expected array of bars from Alpaca, got ${typeof bars}`);
        }
        return bars.sort((a, b) => {
            const ta = this.parseAlpacaTimestamp(a.t);
            const tb = this.parseAlpacaTimestamp(b.t);
            if (ta === null || tb === null)
                return 0;
            return ta - tb;
        });
    }
    aggregate1mTo5m(candles) {
        if (candles.length === 0)
            return [];
        const groups = {};
        for (const candle of candles) {
            const bucket = Math.floor(candle.t / (5 * 60 * 1000)) * (5 * 60 * 1000);
            if (!groups[bucket]) {
                groups[bucket] = [];
            }
            groups[bucket].push(candle);
        }
        return Object.keys(groups)
            .map(Number)
            .sort((a, b) => a - b)
            .map((bucket) => {
            const group = groups[bucket];
            const opens = group.map((c) => c.o);
            const closes = group.map((c) => c.c);
            const highs = group.map((c) => c.h);
            const lows = group.map((c) => c.l);
            return {
                o: opens[0],
                h: Math.max(...highs),
                l: Math.min(...lows),
                c: closes[closes.length - 1],
                v: group.reduce((sum, c) => sum + c.v, 0),
                t: bucket,
            };
        });
    }
    estimateAvgVolume(bars) {
        if (bars.length === 0)
            return 1;
        const totalVolume = bars.reduce((sum, bar) => sum + bar.v, 0);
        return Math.max(totalVolume, 1);
    }
    parseAlpacaTimestamp(raw) {
        if (typeof raw === 'number') {
            if (!Number.isFinite(raw))
                return null;
            return raw * 1000;
        }
        if (typeof raw === 'string') {
            const parsed = Date.parse(raw);
            if (Number.isNaN(parsed))
                return null;
            return parsed;
        }
        return null;
    }
    getTodayET() {
        return new Date().toLocaleDateString('en-CA', {
            timeZone: 'America/New_York',
        });
    }
    emptySnapshot(ticker) {
        return {
            ticker: ticker.toUpperCase(),
            price: 0,
            vwap: null,
            vwap_line: [],
            ema9: null,
            ema20: null,
            volume: 0,
            avg_volume: 1,
            relative_volume: 0,
            change_pct: 0,
            pre_market_high: null,
            candles_1min: [],
            candles_5min: [],
            atr: 0.5,
            high_of_day: 0,
            low_of_day: 0,
        };
    }
    async fetchBarsFromAlpacaDirect(params) {
        const url = `${this.alpacaBaseUrl}/${params.symbol}/bars`;
        const headers = {
            'APCA-API-KEY-ID': this.alpacaKeyId,
            'APCA-API-SECRET-KEY': this.alpacaSecretKey,
        };
        try {
            const response = await axios_1.default.get(url, {
                params: {
                    feed: params.feed,
                    timeframe: params.timeframe,
                    start: params.start,
                    end: params.end,
                    limit: params.limit.toString(),
                },
                headers,
                timeout: this.requestTimeoutMs,
            });
            this.logger.debug(`✅ Direct API call successful for ${params.symbol}: ${response.status}`);
            return response.data;
        }
        catch (error) {
            const errMsg = error instanceof axios_1.AxiosError ? error.message : String(error);
            this.logger.error(`❌ Direct API call failed for ${params.symbol}: ${errMsg}`);
            return null;
        }
    }
    clearCache() {
        this.cache.clear();
        this.logger.log('🗑️ Alpaca cache cleared');
    }
    async fetch1mBarsForDate(symbol, dateStr) {
        const bars = await this.fetchBarWithRetries(symbol, dateStr);
        return bars
            .map((bar) => {
            const t = this.parseAlpacaTimestamp(bar.t);
            if (t === null)
                return null;
            return { o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v, t };
        })
            .filter((c) => c !== null && c.t > 0);
    }
};
exports.AlpacaDataSource = AlpacaDataSource;
exports.AlpacaDataSource = AlpacaDataSource = AlpacaDataSource_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AlpacaDataSource);
//# sourceMappingURL=alpaca-datasource.js.map