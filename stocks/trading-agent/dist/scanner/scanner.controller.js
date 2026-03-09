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
const _datasourcefactory = require("./datasource/datasource.factory");
const _mysqltrainingrepository = require("./mysql/mysql-training.repository");
const _smallcaptrading = require("../small-cap-trading");
const _scannertool = require("../agent/tools/scanner.tool");
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
   * GET /scanner/dates
   * Returns available dates in MySQL (stock-training). For date picker.
   */ async getDates() {
        const dates = await this.dataSourceFactory.getAvailableDates();
        return {
            dates
        };
    }
    /**
   * GET /scanner/snapshot/:ticker?cutoff=<unix_ms>&date=YYYY-MM-DD
   * Returns snapshot for a ticker. date=today or omitted → momoscreener. date=historical → MySQL.
   * cutoff: simulation/replay trim. Includes strategy detection.
   */ async getSnapshot(ticker, cutoff, date) {
        const cutoffMs = cutoff ? parseInt(cutoff, 10) : undefined;
        const source = this.dataSourceFactory.getDataSource(date);
        const snap = await source.getStockSnapshot(ticker.toUpperCase(), {
            cutoffMs,
            timeframe: '5m',
            date
        });
        // Real-time strategy detection via trading rules engine
        const refDate = cutoffMs ? new Date(cutoffMs) : new Date();
        const etTime = refDate.toLocaleTimeString('en-CA', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }); // "14:30" format for getSession
        const session = (0, _scannertool.getSession)(etTime);
        const candlesForRules = snap.candles_5min;
        const rules = (0, _smallcaptrading.applyTradingRules)({
            ticker: snap.ticker,
            price: snap.price,
            vwap: snap.vwap,
            ema9: snap.ema9,
            ema20: snap.ema20,
            relative_volume: snap.relative_volume,
            change_pct: snap.change_pct,
            atr: snap.atr,
            session,
            pre_market_high: snap.pre_market_high,
            account_size: 25000,
            last_candles_json: JSON.stringify(candlesForRules.slice(-30))
        });
        return {
            ...snap,
            strategy: {
                name: rules.identified_strategy,
                viable: rules.viable,
                entry: rules.entry_zone?.price ?? null,
                stop: rules.stop_loss?.price ?? null,
                target_1: rules.target_1?.price ?? null,
                target_2: rules.target_2?.price ?? null,
                pattern_signals: rules.pattern_signals ?? [],
                pattern_points: (rules.detected_patterns ?? []).flatMap((p)=>p.anchor_points),
                strategy_guidance: rules.strategy_guidance ?? null
            }
        };
    }
    /**
   * GET /scanner/strategy/:ticker?cutoff=<unix_ms>
   * Lightweight: returns only the current pattern in play (for UI polling every 1s).
   */ async getPattern(ticker, cutoff, date) {
        const cutoffMs = cutoff ? parseInt(cutoff, 10) : undefined;
        const source = this.dataSourceFactory.getDataSource(date);
        const snap = await source.getStockSnapshot(ticker.toUpperCase(), {
            cutoffMs,
            timeframe: '5m',
            date
        });
        const refDate = cutoffMs ? new Date(cutoffMs) : new Date();
        const etTime = refDate.toLocaleTimeString('en-CA', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        const session = (0, _scannertool.getSession)(etTime);
        const candlesForRules = snap.candles_5min;
        const rules = (0, _smallcaptrading.applyTradingRules)({
            ticker: snap.ticker,
            price: snap.price,
            vwap: snap.vwap,
            ema9: snap.ema9,
            ema20: snap.ema20,
            relative_volume: snap.relative_volume,
            change_pct: snap.change_pct,
            atr: snap.atr,
            session,
            pre_market_high: snap.pre_market_high,
            account_size: 25000,
            last_candles_json: JSON.stringify(candlesForRules.slice(-30))
        });
        return {
            name: rules.identified_strategy,
            viable: rules.viable,
            points: (rules.detected_patterns ?? []).flatMap((p)=>p.anchor_points),
            strategy_guidance: rules.strategy_guidance ?? null
        };
    }
    /**
   * GET /scanner/news/:ticker
   * Returns news headlines and catalyst analysis for a ticker.
   */ async getNews(ticker) {
        const sym = ticker.toUpperCase();
        let headlines = await (0, _newstool.fetchYahooNews)(sym);
        if (!headlines.length) headlines = await (0, _newstool.fetchFinvizNews)(sym);
        const { strength, catalyst_type, is_dilutive, justifies_move } = await (0, _newstool.scoreHeadlines)(headlines);
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
   * GET /scanner/topmovers?date=YYYY-MM-DD
   * date=today o omitido → momoscreener (live). date=histórico → MySQL (stock-training).
   */ async getTopMovers(date) {
        const today = new Date().toLocaleDateString('en-CA', {
            timeZone: 'America/New_York'
        });
        if (!date || date === today) {
            return this.getMomoFromApi();
        }
        return this.getMomoFromMysql(date);
    }
    async getMomoFromMysql(dateStr) {
        const rows = await this.mysqlRepo.getTopMovers(dateStr);
        return rows.map((r)=>({
                symbol: r.symbol,
                price: r.close,
                change: r.change_pct * 100,
                change5m: 0,
                volume: r.volume,
                float: null,
                headline: '',
                headline_source: 'MySQL',
                ideal: r.change_pct >= 0.10
            }));
    }
    async getMomoFromApi() {
        return this.getMomo('5', '3');
    }
    /**
   * GET /scanner/momo?int=5&change=3
   * Returns deduplicated list of top movers from momoscreener momo API (live only).
   * @deprecated Use GET /scanner/top-movers?date= for date-aware list.
   */ async getMomo(interval = '5', change = '3') {
        const url = `https://momoscreener.com/api/momo?int=${interval}&change=${change}`;
        let items = [];
        try {
            const res = await _axios.default.get(url, {
                timeout: 10000
            });
            items = res.data?.message ?? [];
        } catch (err) {
            this.logger.warn(`momo API failed: ${err?.message || err}`);
            return []; // Return empty list so UI doesn't break; user can type ticker manually
        }
        const volOf = (item)=>item.live?.totalVolume ?? item.stats?.volume ?? item.quote?.totalVolume ?? 0;
        // Deduplicate by symbol — keep the entry with highest volume
        const bySymbol = new Map();
        for (const item of items){
            const sym = item.symbol;
            if (!sym) continue;
            const existing = bySymbol.get(sym);
            const vol = volOf(item);
            if (!existing || vol > volOf(existing)) {
                bySymbol.set(sym, item);
            }
        }
        const IDEAL_PRICE_MIN = 2;
        const IDEAL_PRICE_MAX = 20;
        const IDEAL_CHANGE_PCT = 10;
        const IDEAL_FLOAT_MAX = 20_000_000;
        const IDEAL_REL_VOL = 5;
        const headlineOf = (item)=>{
            const n = item.news;
            const raw = Array.isArray(n) ? n[0]?.headline : n?.headline;
            return raw ? String(raw).replace(/&#39;/g, "'").replace(/&amp;/g, '&') : '';
        };
        const sourceOf = (item)=>{
            const n = item.news;
            return (Array.isArray(n) ? n[0]?.source : n?.source) ?? '';
        };
        const mapped = [
            ...bySymbol.values()
        ].map((item)=>{
            const price = item.live?.lastPrice ?? item.stats?.price ?? item.quote?.lastPrice ?? 0;
            const change = item.change ?? 0;
            const volume = volOf(item);
            const float = item.stats?.floatShares ?? null;
            const headline = headlineOf(item);
            const avgVol = item.stats?.avgVolume ?? item.quote?.totalVolume;
            const relVol = avgVol && avgVol > 0 ? volume / avgVol : null;
            const ideal = price >= IDEAL_PRICE_MIN && price <= IDEAL_PRICE_MAX && change >= IDEAL_CHANGE_PCT && (float == null || float <= IDEAL_FLOAT_MAX) && !!headline?.trim() && (relVol == null || relVol >= IDEAL_REL_VOL);
            return {
                symbol: item.symbol,
                price,
                change,
                change5m: item.change5m ?? 0,
                volume,
                float,
                headline,
                headline_source: sourceOf(item),
                ideal
            };
        });
        // Sort by change descending (hot movers first)
        mapped.sort((a, b)=>b.change - a.change);
        return mapped;
    }
    constructor(scannerService, dataSourceFactory, mysqlRepo){
        this.scannerService = scannerService;
        this.dataSourceFactory = dataSourceFactory;
        this.mysqlRepo = mysqlRepo;
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
    (0, _common.Get)('dates'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], ScannerController.prototype, "getDates", null);
_ts_decorate([
    (0, _common.Get)('snapshot/:ticker'),
    _ts_param(0, (0, _common.Param)('ticker')),
    _ts_param(1, (0, _common.Query)('cutoff')),
    _ts_param(2, (0, _common.Query)('date')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], ScannerController.prototype, "getSnapshot", null);
_ts_decorate([
    (0, _common.Get)('strategy/:ticker'),
    _ts_param(0, (0, _common.Param)('ticker')),
    _ts_param(1, (0, _common.Query)('cutoff')),
    _ts_param(2, (0, _common.Query)('date')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String,
        String,
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], ScannerController.prototype, "getPattern", null);
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
    (0, _common.Get)('topmovers'),
    _ts_param(0, (0, _common.Query)('date')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        String
    ]),
    _ts_metadata("design:returntype", Promise)
], ScannerController.prototype, "getTopMovers", null);
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
        typeof _scannerservice.ScannerService === "undefined" ? Object : _scannerservice.ScannerService,
        typeof _datasourcefactory.StockDataSourceFactory === "undefined" ? Object : _datasourcefactory.StockDataSourceFactory,
        typeof _mysqltrainingrepository.MysqlTrainingRepository === "undefined" ? Object : _mysqltrainingrepository.MysqlTrainingRepository
    ])
], ScannerController);

//# sourceMappingURL=scanner.controller.js.map