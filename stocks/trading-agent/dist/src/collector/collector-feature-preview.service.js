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
var CollectorFeaturePreviewService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectorFeaturePreviewService = void 0;
const common_1 = require("@nestjs/common");
const promise_pool_1 = require("@supercharge/promise-pool");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const dotenv_1 = require("dotenv");
const training_row_builder_1 = require("../training/training-row-builder");
const premarket_volume_feature_1 = require("../training/premarket-volume.feature");
const fundamental_cache_service_1 = require("../training/fundamental-cache.service");
const indicator_calculator_1 = require("./indicator.calculator");
function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
let CollectorFeaturePreviewService = CollectorFeaturePreviewService_1 = class CollectorFeaturePreviewService {
    constructor(fundamentalCache) {
        this.fundamentalCache = fundamentalCache;
        this.logger = new common_1.Logger(CollectorFeaturePreviewService_1.name);
        this.fallbackEnv = this.loadFallbackEnv();
    }
    loadFallbackEnv() {
        try {
            const p = path.resolve(process.cwd(), '../stock-training/.env');
            if (!fs.existsSync(p))
                return {};
            return (0, dotenv_1.parse)(fs.readFileSync(p, 'utf8'));
        }
        catch {
            return {};
        }
    }
    getEnvAny(names) {
        for (const n of names) {
            const v = process.env[n]?.trim();
            if (v)
                return v;
        }
        for (const n of names) {
            const v = this.fallbackEnv[n]?.trim();
            if (v)
                return v;
        }
        return '';
    }
    marketDataHeaders() {
        const key = this.getEnvAny(['ALPACA_API_KEY_ID', 'ALPACA_KEY_ID']);
        const secret = this.getEnvAny(['ALPACA_API_SECRET_KEY', 'ALPACA_SECRET_KEY']);
        return {
            accept: 'application/json',
            'APCA-API-KEY-ID': key,
            'APCA-API-SECRET-KEY': secret,
        };
    }
    etDateTimeToUtcIso(dateStr, time) {
        const [year, month, day] = dateStr.split('-').map(Number);
        const [hh, mm, ss = '00'] = time.split(':');
        const approxUtc = new Date(`${dateStr}T${time}Z`);
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            timeZoneName: 'shortOffset',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(approxUtc);
        const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
        const match = tzName.match(/([A-Z]+)([+-])(\d{1,2})(?::?(\d{2}))?/i);
        const sign = match?.[2] === '-' ? -1 : 1;
        const oh = Number(match?.[3] ?? 5);
        const om = Number(match?.[4] ?? 0);
        const offsetMin = sign * (oh * 60 + om);
        const utcMs = Date.UTC(year, month - 1, day, Number(hh), Number(mm), Number(ss)) - offsetMin * 60_000;
        return new Date(utcMs).toISOString();
    }
    async fetchBarsWithExtendedHours(symbol, dateStr) {
        const isTodayEt = dateStr === this.todayEt();
        const startIso = this.etDateTimeToUtcIso(dateStr, '00:00:00');
        const endIso = isTodayEt ? new Date().toISOString() : this.etDateTimeToUtcIso(dateStr, '23:59:59');
        let pageToken;
        const merged = [];
        while (true) {
            const url = new URL('https://data.alpaca.markets/v2/stocks/bars');
            url.searchParams.set('symbols', symbol);
            url.searchParams.set('timeframe', '1Min');
            url.searchParams.set('start', startIso);
            url.searchParams.set('end', endIso);
            url.searchParams.set('adjustment', 'split');
            url.searchParams.set('sort', 'asc');
            url.searchParams.set('limit', '10000');
            url.searchParams.set('feed', 'sip');
            if (pageToken)
                url.searchParams.set('page_token', pageToken);
            const res = await fetch(url.toString(), { method: 'GET', headers: this.marketDataHeaders() });
            if (!res.ok) {
                const body = await res.text().catch(() => '<no-body>');
                throw new Error(`alpaca bars ${res.status}: ${body}`);
            }
            const data = (await res.json());
            const bars = data.bars?.[symbol] ?? [];
            for (const b of bars) {
                const t = Date.parse(b.t);
                if (!Number.isFinite(t) || t <= 0)
                    continue;
                const et = (0, indicator_calculator_1.timestampToET)(t);
                if (et.date !== dateStr)
                    continue;
                merged.push({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, t });
            }
            pageToken = data.next_page_token ?? undefined;
            if (!pageToken)
                break;
        }
        merged.sort((a, b) => a.t - b.t);
        return merged;
    }
    todayEt() {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
    }
    prevTradingDay(dateStr) {
        const d = new Date(`${dateStr}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        const dow = d.getUTCDay();
        if (dow === 0)
            d.setUTCDate(d.getUTCDate() - 2);
        else if (dow === 6)
            d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
    }
    parseSymbols(input) {
        const fromArray = (input.symbols ?? []).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
        const fromCsv = (input.symbolsCsv ?? '')
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);
        return [...new Set([...fromArray, ...fromCsv])];
    }
    concurrency() {
        return toPositiveInt(process.env.SCREENER_CHUNK_CONCURRENCY, 5);
    }
    async buildFeaturesForSymbolsByDate(input) {
        const symbols = this.parseSymbols(input);
        if (!symbols.length) {
            return { ok: false, date: input.date ?? this.todayEt(), results: [], error: 'symbols required' };
        }
        const dateStr = input.date?.trim() || this.todayEt();
        const includeCandles = input.includeCandles ?? false;
        const out = [];
        await promise_pool_1.PromisePool.withConcurrency(this.concurrency())
            .for(symbols)
            .process(async (symbol) => {
            out.push(await this.buildForOneSymbol(symbol, dateStr, includeCandles));
        });
        out.sort((a, b) => a.symbol.localeCompare(b.symbol));
        return { ok: true, date: dateStr, results: out };
    }
    async buildForOneSymbol(symbol, dateStr, includeCandles) {
        try {
            const candles = await this.fetchBarsWithExtendedHours(symbol, dateStr);
            if (!candles.length) {
                return { symbol, candlesCount: 0, metadata: null, rows: [], error: 'no_data' };
            }
            const trainingCandles = candles.map((c) => ({ ...c }));
            const prevDate = this.prevTradingDay(dateStr);
            let priorClose = 0;
            try {
                const prevBars = await this.fetchBarsWithExtendedHours(symbol, prevDate);
                if (prevBars.length)
                    priorClose = prevBars[prevBars.length - 1].c;
            }
            catch {
                priorClose = trainingCandles[0]?.o ?? trainingCandles[0]?.c ?? 0;
            }
            if (priorClose <= 0)
                priorClose = trainingCandles[0]?.o ?? trainingCandles[0]?.c ?? 0;
            const openDay = trainingCandles[0].o;
            const firstRegular = trainingCandles.find((c) => {
                const { minuteOfDay } = (0, indicator_calculator_1.timestampToET)(c.t);
                return minuteOfDay >= 9 * 60 + 30;
            });
            const openFirst = firstRegular?.o ?? openDay;
            const premarketVolume = (0, premarket_volume_feature_1.computePremarketVolume)(trainingCandles);
            const preMarketCandles = trainingCandles.filter((c) => (0, indicator_calculator_1.timestampToET)(c.t).minuteOfDay < 9 * 60 + 30);
            const preMarketHigh = preMarketCandles.length ? Math.max(...preMarketCandles.map((c) => c.h)) : null;
            const fundamentals = await this.fundamentalCache.getFundamentals(symbol);
            const metadata = {
                priorClose,
                preMarketHigh: preMarketHigh ?? 0,
                sharesOutstanding: fundamentals.sharesOutstanding ?? null,
                marketCap: fundamentals.marketCap ?? null,
                gapPct: priorClose > 0 ? (openFirst - priorClose) / priorClose : 0,
                premarketVolume,
                openDay,
                openFirst,
                prevTradingDate: prevDate,
            };
            const rows = [];
            for (let i = 0; i < trainingCandles.length; i++) {
                rows.push((0, training_row_builder_1.buildTrainingRow)({
                    symbol,
                    date: dateStr,
                    candles: trainingCandles,
                    idx: i,
                    priorClose,
                    openDay,
                    openFirst,
                    premarketVolume,
                    preMarketHigh,
                    sharesOutstanding: fundamentals.sharesOutstanding,
                    marketCap: fundamentals.marketCap,
                }));
            }
            return {
                symbol,
                candlesCount: trainingCandles.length,
                metadata,
                rows,
                candles: includeCandles ? trainingCandles : undefined,
            };
        }
        catch (e) {
            const msg = e.message;
            this.logger.warn(`features preview failed for ${symbol} ${dateStr}: ${msg}`);
            return { symbol, candlesCount: 0, metadata: null, rows: [], error: msg };
        }
    }
};
exports.CollectorFeaturePreviewService = CollectorFeaturePreviewService;
exports.CollectorFeaturePreviewService = CollectorFeaturePreviewService = CollectorFeaturePreviewService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [fundamental_cache_service_1.FundamentalCacheService])
], CollectorFeaturePreviewService);
//# sourceMappingURL=collector-feature-preview.service.js.map