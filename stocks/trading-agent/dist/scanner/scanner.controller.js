"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ScannerController", {
    enumerable: true,
    get: function() {
        return ScannerController;
    }
});
const _common = require("@nestjs/common");
const _axios = /*#__PURE__*/ _interop_require_default(require("axios"));
const _scannerservice = require("./scanner.service");
const _newstool = require("../agent/tools/news.tool");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
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
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
let ScannerController = class ScannerController {
    /**
   * GET /scanner/watchlist
   * Returns today's pre-market gappers filtered by trading criteria.
   */ async getWatchlist() {
        this.logger.log('Manual watchlist request triggered.');
        const candidates = await this.scannerService.runScanner();
        return {
            generated_at: new Date().toISOString(),
            count: candidates.length,
            candidates
        };
    }
    /**
   * GET /scanner/snapshot/:ticker?cutoff=<unix_ms>
   * Returns snapshot for a ticker. If cutoff is provided, data is trimmed
   * to only include candles up to that timestamp (simulation / replay mode).
   */ async getSnapshot(ticker, cutoff) {
        const cutoffMs = cutoff ? parseInt(cutoff, 10) : undefined;
        return this.scannerService.getStockSnapshot(ticker.toUpperCase(), cutoffMs);
    }
    /**
   * GET /scanner/news/:ticker
   * Returns news headlines and catalyst analysis for a ticker.
   */ async getNews(ticker) {
        const sym = ticker.toUpperCase();
        let headlines = await (0, _newstool.fetchYahooNews)(sym);
        if (!headlines.length) headlines = await (0, _newstool.fetchFinvizNews)(sym);
        const { strength, catalyst_type, is_dilutive, justifies_move } = (0, _newstool.scoreHeadlines)(headlines);
        const recentCount = headlines.filter((h)=>h.age_minutes < 60).length;
        const confidence = strength === 'NONE' ? 0.1 : strength === 'WEAK' ? 0.3 : strength === 'MODERATE' ? 0.6 : recentCount > 0 ? 0.9 : 0.7;
        let trade_implication = '';
        if (is_dilutive) {
            trade_implication = 'AVOID LONG — Dilutive event detected. Stock likely to sell off.';
        } else if (strength === 'STRONG') {
            trade_implication = 'Move is justified. Look for bull flag, ABCD, or ORB setup on a pullback. High conviction.';
        } else if (strength === 'MODERATE') {
            trade_implication = 'Some basis but take smaller size. Wait for clean technical setup. Risk of reversal.';
        } else if (strength === 'WEAK') {
            trade_implication = 'Caution on longs. News may cap upside or cause sell-the-news.';
        } else {
            trade_implication = 'No news catalyst — pure technical move. High risk of reversal. Use tight stops.';
        }
        return {
            ticker: sym,
            headlines,
            catalyst_strength: strength,
            catalyst_type,
            justifies_move,
            confidence,
            is_dilutive,
            summary: `${headlines.length} headline(s) found. Catalyst: ${catalyst_type}.`,
            trade_implication
        };
    }
    /**
   * GET /scanner/momo?int=5&change=3
   * Returns deduplicated list of top movers from momoscreener momo API.
   */ async getMomo(interval = '5', change = '3') {
        const url = `https://momoscreener.com/api/momo?int=${interval}&change=${change}`;
        const res = await _axios.default.get(url, {
            timeout: 8000
        });
        const items = res.data?.message ?? [];
        // Deduplicate by symbol — keep the entry with highest volume
        const bySymbol = new Map();
        for (const item of items){
            const sym = item.symbol;
            if (!sym) continue;
            const existing = bySymbol.get(sym);
            const vol = item.quote?.totalVolume ?? 0;
            if (!existing || vol > (existing.quote?.totalVolume ?? 0)) {
                bySymbol.set(sym, item);
            }
        }
        const mapped = [
            ...bySymbol.values()
        ].map((item)=>({
                symbol: item.symbol,
                price: item.live?.lastPrice ?? item.stats?.price ?? item.quote?.lastPrice ?? 0,
                change: item.change ?? 0,
                change5m: item.change5m ?? 0,
                volume: item.quote?.totalVolume ?? 0,
                float: item.stats?.floatShares ?? null,
                headline: item.news?.headline ? item.news.headline.replace(/&#39;/g, "'").replace(/&amp;/g, '&') : '',
                headline_source: item.news?.source ?? ''
            }));
        // Filter by ideal Stock in Play conditions:
        // Price $2–$20 | Change ≥10% | Rel vol ≥5x | Catalyst (news) | Float <20M
        const IDEAL_PRICE_MIN = 2;
        const IDEAL_PRICE_MAX = 20;
        const IDEAL_CHANGE_PCT = 10;
        const IDEAL_REL_VOL = 5;
        const IDEAL_FLOAT_MAX = 20_000_000;
        return mapped.filter((s)=>{
            if (s.price < IDEAL_PRICE_MIN || s.price > IDEAL_PRICE_MAX) return false;
            if (s.change < IDEAL_CHANGE_PCT) return false;
            // Float: exclude if known and >20M; allow if null (unknown)
            if (s.float != null && s.float > IDEAL_FLOAT_MAX) return false;
            // Catalyst: must have news headline (technical breakout not detectable from momo API)
            if (!s.headline?.trim()) return false;
            // Rel vol: need avgVolume from source — use raw item to compute
            const raw = [
                ...bySymbol.values()
            ].find((x)=>x.symbol === s.symbol);
            const avgVol = raw?.stats?.avgVolume ?? raw?.quote?.totalVolume;
            if (avgVol && avgVol > 0) {
                const relVol = s.volume / avgVol;
                if (relVol < IDEAL_REL_VOL) return false;
            }
            return true;
        });
    }
    constructor(scannerService){
        this.scannerService = scannerService;
        this.logger = new _common.Logger(ScannerController.name);
    }
};
_ts_decorate([
    (0, _common.Get)('watchlist'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], ScannerController.prototype, "getWatchlist", null);
_ts_decorate([
    (0, _common.Get)('snapshot/:ticker'),
    _ts_param(0, (0, _common.Param)('ticker')),
    _ts_param(1, (0, _common.Query)('cutoff')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], ScannerController.prototype, "getSnapshot", null);
_ts_decorate([
    (0, _common.Get)('news/:ticker'),
    _ts_param(0, (0, _common.Param)('ticker')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], ScannerController.prototype, "getNews", null);
_ts_decorate([
    (0, _common.Get)('momo'),
    _ts_param(0, (0, _common.Query)('int')),
    _ts_param(1, (0, _common.Query)('change')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        void 0,
        void 0
    ]),
    _ts_metadata("design:returntype", Promise)
], ScannerController.prototype, "getMomo", null);
ScannerController = _ts_decorate([
    (0, _common.Controller)('scanner'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _scannerservice.ScannerService === "undefined" ? Object : _scannerservice.ScannerService
    ])
], ScannerController);

//# sourceMappingURL=scanner.controller.js.map