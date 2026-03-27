"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CollectorFeaturePreviewService", {
    enumerable: true,
    get: function() {
        return CollectorFeaturePreviewService;
    }
});
const _common = require("@nestjs/common");
const _promisepool = require("@supercharge/promise-pool");
const _nodefs = /*#__PURE__*/ _interop_require_wildcard(require("node:fs"));
const _nodepath = /*#__PURE__*/ _interop_require_wildcard(require("node:path"));
const _dotenv = require("dotenv");
const _trainingrowbuilder = require("../training/training-row-builder");
const _premarketvolumefeature = require("../training/premarket-volume.feature");
const _fundamentalcacheservice = require("../training/fundamental-cache.service");
const _indicatorcalculator = require("./indicator.calculator");
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
let CollectorFeaturePreviewService = class CollectorFeaturePreviewService {
    loadFallbackEnv() {
        try {
            const p = _nodepath.resolve(process.cwd(), '../stock-training/.env');
            if (!_nodefs.existsSync(p)) return {};
            return (0, _dotenv.parse)(_nodefs.readFileSync(p, 'utf8'));
        } catch  {
            return {};
        }
    }
    getEnvAny(names) {
        for (const n of names){
            const v = process.env[n]?.trim();
            if (v) return v;
        }
        for (const n of names){
            const v = this.fallbackEnv[n]?.trim();
            if (v) return v;
        }
        return '';
    }
    marketDataHeaders() {
        const key = this.getEnvAny([
            'ALPACA_API_KEY_ID',
            'ALPACA_KEY_ID'
        ]);
        const secret = this.getEnvAny([
            'ALPACA_API_SECRET_KEY',
            'ALPACA_SECRET_KEY'
        ]);
        return {
            accept: 'application/json',
            'APCA-API-KEY-ID': key,
            'APCA-API-SECRET-KEY': secret
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
            hourCycle: 'h23'
        }).formatToParts(approxUtc);
        const tzName = parts.find((p)=>p.type === 'timeZoneName')?.value ?? 'GMT-5';
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
        while(true){
            const url = new URL('https://data.alpaca.markets/v2/stocks/bars');
            url.searchParams.set('symbols', symbol);
            url.searchParams.set('timeframe', '1Min');
            url.searchParams.set('start', startIso);
            url.searchParams.set('end', endIso);
            url.searchParams.set('adjustment', 'split');
            url.searchParams.set('sort', 'asc');
            url.searchParams.set('limit', '10000');
            url.searchParams.set('feed', 'sip');
            if (pageToken) url.searchParams.set('page_token', pageToken);
            const res = await fetch(url.toString(), {
                method: 'GET',
                headers: this.marketDataHeaders()
            });
            if (!res.ok) {
                const body = await res.text().catch(()=>'<no-body>');
                throw new Error(`alpaca bars ${res.status}: ${body}`);
            }
            const data = await res.json();
            const bars = data.bars?.[symbol] ?? [];
            for (const b of bars){
                const t = Date.parse(b.t);
                if (!Number.isFinite(t) || t <= 0) continue;
                const et = (0, _indicatorcalculator.timestampToET)(t);
                if (et.date !== dateStr) continue;
                merged.push({
                    o: b.o,
                    h: b.h,
                    l: b.l,
                    c: b.c,
                    v: b.v,
                    t
                });
            }
            pageToken = data.next_page_token ?? undefined;
            if (!pageToken) break;
        }
        merged.sort((a, b)=>a.t - b.t);
        return merged;
    }
    todayEt() {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());
    }
    prevTradingDay(dateStr) {
        const d = new Date(`${dateStr}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 1);
        const dow = d.getUTCDay();
        if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
        else if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
    }
    parseSymbols(input) {
        const fromArray = (input.symbols ?? []).map((s)=>String(s).trim().toUpperCase()).filter(Boolean);
        const fromCsv = (input.symbolsCsv ?? '').split(',').map((s)=>s.trim().toUpperCase()).filter(Boolean);
        return [
            ...new Set([
                ...fromArray,
                ...fromCsv
            ])
        ];
    }
    concurrency() {
        return toPositiveInt(process.env.SCREENER_CHUNK_CONCURRENCY, 5);
    }
    async buildFeaturesForSymbolsByDate(input) {
        const symbols = this.parseSymbols(input);
        if (!symbols.length) {
            return {
                ok: false,
                date: input.date ?? this.todayEt(),
                results: [],
                error: 'symbols required'
            };
        }
        const dateStr = input.date?.trim() || this.todayEt();
        const includeCandles = input.includeCandles ?? false;
        const out = [];
        await _promisepool.PromisePool.withConcurrency(this.concurrency()).for(symbols).process(async (symbol)=>{
            out.push(await this.buildForOneSymbol(symbol, dateStr, includeCandles));
        });
        out.sort((a, b)=>a.symbol.localeCompare(b.symbol));
        return {
            ok: true,
            date: dateStr,
            results: out
        };
    }
    async buildForOneSymbol(symbol, dateStr, includeCandles) {
        try {
            const candles = await this.fetchBarsWithExtendedHours(symbol, dateStr);
            if (!candles.length) {
                return {
                    symbol,
                    candlesCount: 0,
                    metadata: null,
                    rows: [],
                    error: 'no_data'
                };
            }
            const trainingCandles = candles.map((c)=>({
                    ...c
                }));
            const prevDate = this.prevTradingDay(dateStr);
            let priorClose = 0;
            try {
                const prevBars = await this.fetchBarsWithExtendedHours(symbol, prevDate);
                if (prevBars.length) priorClose = prevBars[prevBars.length - 1].c;
            } catch  {
                priorClose = trainingCandles[0]?.o ?? trainingCandles[0]?.c ?? 0;
            }
            if (priorClose <= 0) priorClose = trainingCandles[0]?.o ?? trainingCandles[0]?.c ?? 0;
            const openDay = trainingCandles[0].o;
            const firstRegular = trainingCandles.find((c)=>{
                const { minuteOfDay } = (0, _indicatorcalculator.timestampToET)(c.t);
                return minuteOfDay >= 9 * 60 + 30;
            });
            const openFirst = firstRegular?.o ?? openDay;
            const premarketVolume = (0, _premarketvolumefeature.computePremarketVolume)(trainingCandles);
            const preMarketCandles = trainingCandles.filter((c)=>(0, _indicatorcalculator.timestampToET)(c.t).minuteOfDay < 9 * 60 + 30);
            const preMarketHigh = preMarketCandles.length ? Math.max(...preMarketCandles.map((c)=>c.h)) : null;
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
                prevTradingDate: prevDate
            };
            const rows = [];
            for(let i = 0; i < trainingCandles.length; i++){
                rows.push((0, _trainingrowbuilder.buildTrainingRow)({
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
                    marketCap: fundamentals.marketCap
                }));
            }
            return {
                symbol,
                candlesCount: trainingCandles.length,
                metadata,
                rows,
                candles: includeCandles ? trainingCandles : undefined
            };
        } catch (e) {
            const msg = e.message;
            this.logger.warn(`features preview failed for ${symbol} ${dateStr}: ${msg}`);
            return {
                symbol,
                candlesCount: 0,
                metadata: null,
                rows: [],
                error: msg
            };
        }
    }
    constructor(fundamentalCache){
        this.fundamentalCache = fundamentalCache;
        this.logger = new _common.Logger(CollectorFeaturePreviewService.name);
        this.fallbackEnv = this.loadFallbackEnv();
    }
};
CollectorFeaturePreviewService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _fundamentalcacheservice.FundamentalCacheService === "undefined" ? Object : _fundamentalcacheservice.FundamentalCacheService
    ])
], CollectorFeaturePreviewService);

//# sourceMappingURL=collector-feature-preview.service.js.map