"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var ScannerController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScannerController = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
const scanner_service_1 = require("./scanner.service");
const datasource_factory_1 = require("./datasource/datasource.factory");
const mysql_training_repository_1 = require("./mysql/mysql-training.repository");
const small_cap_trading_1 = require("../small-cap-trading");
const scanner_tool_1 = require("../agent/tools/scanner.tool");
const news_tool_1 = require("../agent/tools/news.tool");
let ScannerController = ScannerController_1 = class ScannerController {
    constructor(scannerService, dataSourceFactory, mysqlRepo) {
        this.scannerService = scannerService;
        this.dataSourceFactory = dataSourceFactory;
        this.mysqlRepo = mysqlRepo;
        this.logger = new common_1.Logger(ScannerController_1.name);
    }
    async getWatchlist() {
        this.logger.log('Manual watchlist request triggered.');
        const candidates = await this.scannerService.runScanner();
        return {
            generated_at: new Date().toISOString(),
            count: candidates.length,
            candidates,
        };
    }
    async getDates() {
        const dates = await this.dataSourceFactory.getAvailableDates();
        return { dates };
    }
    async getSnapshot(ticker, cutoff, date) {
        const cutoffMs = cutoff ? parseInt(cutoff, 10) : undefined;
        const source = this.dataSourceFactory.getDataSource(date);
        const snap = await source.getStockSnapshot(ticker.toUpperCase(), {
            cutoffMs,
            timeframe: '5m',
            date,
        });
        const refDate = cutoffMs ? new Date(cutoffMs) : new Date();
        const etTime = refDate.toLocaleTimeString('en-CA', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        const session = (0, scanner_tool_1.getSession)(etTime);
        const candlesForRules = snap.candles_5min;
        const rules = (0, small_cap_trading_1.applyTradingRules)({
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
            last_candles_json: JSON.stringify(candlesForRules.slice(-30)),
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
                pattern_points: (rules.detected_patterns ?? []).flatMap(p => p.anchor_points),
                strategy_guidance: rules.strategy_guidance ?? null,
            },
        };
    }
    async getPattern(ticker, cutoff, date) {
        const cutoffMs = cutoff ? parseInt(cutoff, 10) : undefined;
        const source = this.dataSourceFactory.getDataSource(date);
        const snap = await source.getStockSnapshot(ticker.toUpperCase(), { cutoffMs, timeframe: '5m', date });
        const refDate = cutoffMs ? new Date(cutoffMs) : new Date();
        const etTime = refDate.toLocaleTimeString('en-CA', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
        const session = (0, scanner_tool_1.getSession)(etTime);
        const candlesForRules = snap.candles_5min;
        const rules = (0, small_cap_trading_1.applyTradingRules)({
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
            last_candles_json: JSON.stringify(candlesForRules.slice(-30)),
        });
        return {
            name: rules.identified_strategy,
            viable: rules.viable,
            points: (rules.detected_patterns ?? []).flatMap(p => p.anchor_points),
            strategy_guidance: rules.strategy_guidance ?? null,
        };
    }
    async getNews(ticker) {
        const sym = ticker.toUpperCase();
        let headlines = await (0, news_tool_1.fetchYahooNews)(sym);
        if (!headlines.length)
            headlines = await (0, news_tool_1.fetchFinvizNews)(sym);
        const { strength, catalyst_type, is_dilutive, justifies_move } = await (0, news_tool_1.scoreHeadlines)(headlines);
        const recentCount = headlines.filter((h) => h.age_minutes < 60).length;
        const confidence = strength === 'NONE' ? 0.1
            : strength === 'WEAK' ? 0.3
                : strength === 'MODERATE' ? 0.6
                    : recentCount > 0 ? 0.9 : 0.7;
        let trade_implication = '';
        if (is_dilutive) {
            trade_implication = 'AVOID LONG — Dilutive event detected. Stock likely to sell off.';
        }
        else if (strength === 'STRONG') {
            trade_implication = 'Move is justified. Look for bull flag, ABCD, or ORB setup on a pullback. High conviction.';
        }
        else if (strength === 'MODERATE') {
            trade_implication = 'Some basis but take smaller size. Wait for clean technical setup. Risk of reversal.';
        }
        else if (strength === 'WEAK') {
            trade_implication = 'Caution on longs. News may cap upside or cause sell-the-news.';
        }
        else {
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
            trade_implication,
        };
    }
    async getTopMovers(date) {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const targetDate = date || today;
        const mysqlStocks = await this.getMomoFromMysql(targetDate);
        if (mysqlStocks.length > 0)
            return mysqlStocks;
        if (!date || date === today)
            return this.getMomoFromApi();
        return [];
    }
    async getMomoFromMysql(dateStr) {
        const rows = await this.mysqlRepo.getTopMovers(dateStr);
        return rows.map((r) => ({
            symbol: r.symbol,
            price: r.close,
            change: r.change_pct * 100,
            change5m: 0,
            volume: r.volume,
            float: null,
            headline: '',
            headline_source: 'MySQL',
            ideal: r.change_pct >= 0.10,
        }));
    }
    async getMomoFromApi() {
        return this.getMomo('5', '3');
    }
    async getMomo(interval = '5', change = '3') {
        const url = `https://momoscreener.com/api/momo?int=${interval}&change=${change}`;
        let items = [];
        try {
            const res = await axios_1.default.get(url, { timeout: 10000 });
            items = res.data?.message ?? [];
        }
        catch (err) {
            this.logger.warn(`momo API failed: ${err?.message || err}`);
            return [];
        }
        const volOf = (item) => item.live?.totalVolume ?? item.stats?.volume ?? item.quote?.totalVolume ?? 0;
        const bySymbol = new Map();
        for (const item of items) {
            const sym = item.symbol;
            if (!sym)
                continue;
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
        const headlineOf = (item) => {
            const n = item.news;
            const raw = Array.isArray(n) ? n[0]?.headline : n?.headline;
            return raw ? String(raw).replace(/&#39;/g, "'").replace(/&amp;/g, '&') : '';
        };
        const sourceOf = (item) => {
            const n = item.news;
            return (Array.isArray(n) ? n[0]?.source : n?.source) ?? '';
        };
        const mapped = [...bySymbol.values()].map((item) => {
            const price = item.live?.lastPrice ?? item.stats?.price ?? item.quote?.lastPrice ?? 0;
            const change = item.change ?? 0;
            const volume = volOf(item);
            const float = item.stats?.floatShares ?? null;
            const headline = headlineOf(item);
            const avgVol = item.stats?.avgVolume ?? item.quote?.totalVolume;
            const relVol = avgVol && avgVol > 0 ? volume / avgVol : null;
            const ideal = price >= IDEAL_PRICE_MIN && price <= IDEAL_PRICE_MAX &&
                change >= IDEAL_CHANGE_PCT &&
                (float == null || float <= IDEAL_FLOAT_MAX) &&
                !!headline?.trim() &&
                (relVol == null || relVol >= IDEAL_REL_VOL);
            return {
                symbol: item.symbol,
                price,
                change,
                change5m: item.change5m ?? 0,
                volume,
                float,
                headline,
                headline_source: sourceOf(item),
                ideal,
            };
        });
        mapped.sort((a, b) => b.change - a.change);
        return mapped;
    }
};
exports.ScannerController = ScannerController;
__decorate([
    (0, common_1.Get)('watchlist'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ScannerController.prototype, "getWatchlist", null);
__decorate([
    (0, common_1.Get)('dates'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ScannerController.prototype, "getDates", null);
__decorate([
    (0, common_1.Get)('snapshot/:ticker'),
    __param(0, (0, common_1.Param)('ticker')),
    __param(1, (0, common_1.Query)('cutoff')),
    __param(2, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], ScannerController.prototype, "getSnapshot", null);
__decorate([
    (0, common_1.Get)('strategy/:ticker'),
    __param(0, (0, common_1.Param)('ticker')),
    __param(1, (0, common_1.Query)('cutoff')),
    __param(2, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], ScannerController.prototype, "getPattern", null);
__decorate([
    (0, common_1.Get)('news/:ticker'),
    __param(0, (0, common_1.Param)('ticker')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ScannerController.prototype, "getNews", null);
__decorate([
    (0, common_1.Get)('topmovers'),
    __param(0, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ScannerController.prototype, "getTopMovers", null);
__decorate([
    (0, common_1.Get)('momo'),
    __param(0, (0, common_1.Query)('int')),
    __param(1, (0, common_1.Query)('change')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ScannerController.prototype, "getMomo", null);
exports.ScannerController = ScannerController = ScannerController_1 = __decorate([
    (0, common_1.Controller)('scanner'),
    __metadata("design:paramtypes", [scanner_service_1.ScannerService,
        datasource_factory_1.StockDataSourceFactory,
        mysql_training_repository_1.MysqlTrainingRepository])
], ScannerController);
//# sourceMappingURL=scanner.controller.js.map