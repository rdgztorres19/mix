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
var AlpacaScreenerClient_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlpacaScreenerClient = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const dotenv_1 = require("dotenv");
const ASSETS_URL = 'https://paper-api.alpaca.markets/v2/assets';
const BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars';
const SNAPSHOTS_URL = 'https://data.alpaca.markets/v2/stocks/snapshots';
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
let AlpacaScreenerClient = AlpacaScreenerClient_1 = class AlpacaScreenerClient {
    constructor() {
        this.logger = new common_1.Logger(AlpacaScreenerClient_1.name);
        this.maxRetries = toPositiveInt(process.env.SCREENER_MAX_RETRIES, 20);
        this.fallbackEnv = this.loadFallbackEnv();
    }
    loadFallbackEnv() {
        try {
            const p = path.resolve(process.cwd(), '../stock-training/.env');
            if (!fs.existsSync(p))
                return {};
            const raw = fs.readFileSync(p, 'utf8');
            return (0, dotenv_1.parse)(raw);
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
    tradingHeaders() {
        const key = this.getEnvAny(['ALPACA_PAPER_API_KEY_ID', 'ALPACA_PAPER_KEY_ID']);
        const secret = this.getEnvAny(['ALPACA_PAPER_API_SECRET_KEY', 'ALPACA_PAPER_SECRET_KEY']);
        if (!key || !secret) {
            throw new Error('Missing paper trading keys for paper-api assets: set ALPACA_PAPER_API_KEY_ID + ALPACA_PAPER_API_SECRET_KEY (or ALPACA_PAPER_KEY_ID + ALPACA_PAPER_SECRET_KEY)');
        }
        return {
            accept: 'application/json',
            'APCA-API-KEY-ID': key,
            'APCA-API-SECRET-KEY': secret,
        };
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
    async safeReadText(res) {
        try {
            return await res.text();
        }
        catch {
            return '<no-body>';
        }
    }
    async fetchWithRetry(url, headers, context) {
        let attempt = 0;
        while (true) {
            attempt += 1;
            const res = await fetch(url, { method: 'GET', headers });
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
        return (await res.json());
    }
    async fetchSnapshotsForChunk(symbols) {
        if (!symbols.length)
            return {};
        const url = new URL(SNAPSHOTS_URL);
        url.searchParams.set('symbols', symbols.join(','));
        const res = await this.fetchWithRetry(url.toString(), this.marketDataHeaders(), `snapshots chunk size=${symbols.length}`);
        return (await res.json());
    }
    async fetchDailyBarsForChunk(symbols, startDate, endDate) {
        const merged = {};
        let pageToken;
        while (true) {
            const url = new URL(BARS_URL);
            url.searchParams.set('symbols', symbols.join(','));
            url.searchParams.set('timeframe', '1Day');
            url.searchParams.set('start', `${startDate}T00:00:00Z`);
            url.searchParams.set('end', `${endDate}T23:59:59Z`);
            url.searchParams.set('adjustment', 'split');
            url.searchParams.set('sort', 'asc');
            url.searchParams.set('limit', '10000');
            if (pageToken)
                url.searchParams.set('page_token', pageToken);
            const res = await this.fetchWithRetry(url.toString(), this.marketDataHeaders(), `bars chunk size=${symbols.length}`);
            const data = (await res.json());
            for (const [symbol, bars] of Object.entries(data.bars || {})) {
                if (!merged[symbol])
                    merged[symbol] = [];
                merged[symbol] = merged[symbol].concat(bars);
            }
            pageToken = data.next_page_token || undefined;
            if (!pageToken)
                break;
        }
        return merged;
    }
};
exports.AlpacaScreenerClient = AlpacaScreenerClient;
exports.AlpacaScreenerClient = AlpacaScreenerClient = AlpacaScreenerClient_1 = __decorate([
    (0, common_1.Injectable)()
], AlpacaScreenerClient);
//# sourceMappingURL=alpaca-screener.client.js.map