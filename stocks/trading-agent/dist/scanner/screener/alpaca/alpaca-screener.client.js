"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AlpacaScreenerClient", {
    enumerable: true,
    get: function() {
        return AlpacaScreenerClient;
    }
});
const _common = require("@nestjs/common");
const _nodefs = /*#__PURE__*/ _interop_require_wildcard(require("node:fs"));
const _nodepath = /*#__PURE__*/ _interop_require_wildcard(require("node:path"));
const _dotenv = require("dotenv");
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
const ASSETS_URL = 'https://paper-api.alpaca.markets/v2/assets';
const BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars';
const SNAPSHOTS_URL = 'https://data.alpaca.markets/v2/stocks/snapshots';
function sleep(ms) {
    return new Promise((resolve)=>setTimeout(resolve, ms));
}
function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
let AlpacaScreenerClient = class AlpacaScreenerClient {
    loadFallbackEnv() {
        try {
            const p = _nodepath.resolve(process.cwd(), '../stock-training/.env');
            if (!_nodefs.existsSync(p)) return {};
            const raw = _nodefs.readFileSync(p, 'utf8');
            return (0, _dotenv.parse)(raw);
        } catch  {
            return {};
        }
    }
    /** First match wins: process.env over each name, then fallback file over each name. */ getEnvAny(names) {
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
    tradingHeaders() {
        const key = this.getEnvAny([
            'ALPACA_PAPER_API_KEY_ID',
            'ALPACA_PAPER_KEY_ID'
        ]);
        const secret = this.getEnvAny([
            'ALPACA_PAPER_API_SECRET_KEY',
            'ALPACA_PAPER_SECRET_KEY'
        ]);
        if (!key || !secret) {
            throw new Error('Missing paper trading keys for paper-api assets: set ALPACA_PAPER_API_KEY_ID + ALPACA_PAPER_API_SECRET_KEY (or ALPACA_PAPER_KEY_ID + ALPACA_PAPER_SECRET_KEY)');
        }
        return {
            accept: 'application/json',
            'APCA-API-KEY-ID': key,
            'APCA-API-SECRET-KEY': secret
        };
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
    async safeReadText(res) {
        try {
            return await res.text();
        } catch  {
            return '<no-body>';
        }
    }
    async fetchWithRetry(url, headers, context) {
        let attempt = 0;
        while(true){
            attempt += 1;
            const res = await fetch(url, {
                method: 'GET',
                headers
            });
            if (res.status === 429) {
                if (attempt > this.maxRetries) {
                    throw new Error(`[${context}] too many 429 retries`);
                }
                this.logger.warn(`[429] ${context} -> waiting 60s (${attempt}/${this.maxRetries})`);
                await sleep(60_000);
                continue;
            }
            if (res.status >= 500 && res.status <= 599) {
                if (attempt > this.maxRetries) {
                    const body = await this.safeReadText(res);
                    throw new Error(`[${context}] ${res.status}: ${body}`);
                }
                const backoff = Math.min(attempt * 5_000, 60_000);
                this.logger.warn(`[${res.status}] ${context} -> waiting ${backoff}ms`);
                await sleep(backoff);
                continue;
            }
            if (!res.ok) {
                const body = await this.safeReadText(res);
                throw new Error(`[${context}] ${res.status}: ${body}`);
            }
            return res;
        }
    }
    async fetchAllActiveUsEquityAssets() {
        const url = new URL(ASSETS_URL);
        url.searchParams.set('status', 'active');
        url.searchParams.set('asset_class', 'us_equity');
        const res = await this.fetchWithRetry(url.toString(), this.tradingHeaders(), 'screener assets');
        return await res.json();
    }
    async fetchSnapshotsForChunk(symbols) {
        if (!symbols.length) return {};
        const url = new URL(SNAPSHOTS_URL);
        url.searchParams.set('symbols', symbols.join(','));
        const res = await this.fetchWithRetry(url.toString(), this.marketDataHeaders(), `snapshots chunk size=${symbols.length}`);
        return await res.json();
    }
    /** One symbol set per request; merges pages. */ async fetchDailyBarsForChunk(symbols, startDate, endDate) {
        const merged = {};
        let pageToken;
        while(true){
            const url = new URL(BARS_URL);
            url.searchParams.set('symbols', symbols.join(','));
            url.searchParams.set('timeframe', '1Day');
            url.searchParams.set('start', `${startDate}T00:00:00Z`);
            url.searchParams.set('end', `${endDate}T23:59:59Z`);
            url.searchParams.set('adjustment', 'split');
            url.searchParams.set('sort', 'asc');
            url.searchParams.set('limit', '10000');
            if (pageToken) url.searchParams.set('page_token', pageToken);
            const res = await this.fetchWithRetry(url.toString(), this.marketDataHeaders(), `bars chunk size=${symbols.length}`);
            const data = await res.json();
            for (const [symbol, bars] of Object.entries(data.bars || {})){
                if (!merged[symbol]) merged[symbol] = [];
                merged[symbol] = merged[symbol].concat(bars);
            }
            pageToken = data.next_page_token || undefined;
            if (!pageToken) break;
        }
        return merged;
    }
    constructor(){
        this.logger = new _common.Logger(AlpacaScreenerClient.name);
        this.maxRetries = toPositiveInt(process.env.SCREENER_MAX_RETRIES, 20);
        this.fallbackEnv = this.loadFallbackEnv();
    }
};
AlpacaScreenerClient = _ts_decorate([
    (0, _common.Injectable)()
], AlpacaScreenerClient);

//# sourceMappingURL=alpaca-screener.client.js.map