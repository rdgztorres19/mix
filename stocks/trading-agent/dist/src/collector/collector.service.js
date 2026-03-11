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
var CollectorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectorService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const axios_1 = __importDefault(require("axios"));
const mysql_training_repository_1 = require("../scanner/mysql/mysql-training.repository");
const scanner_service_1 = require("../scanner/scanner.service");
const momo_stream_service_1 = require("./momo-stream.service");
const collector_gateway_1 = require("./collector.gateway");
const auto_trader_service_1 = require("../trader/auto-trader.service");
const indicator_calculator_1 = require("./indicator.calculator");
let CollectorService = CollectorService_1 = class CollectorService {
    constructor(moduleRef, mysqlRepo, scannerService, momoStream, gateway, autoTrader) {
        this.moduleRef = moduleRef;
        this.mysqlRepo = mysqlRepo;
        this.scannerService = scannerService;
        this.momoStream = momoStream;
        this.gateway = gateway;
        this.autoTrader = autoTrader;
        this.logger = new common_1.Logger(CollectorService_1.name);
        this.activeSymbols = new Map();
        this.momoBase = process.env.MOMO_BASE_URL ?? 'https://momoscreener.com/api/p';
        if (this.autoTrader)
            this.autoTrader.setGateway(this.gateway);
    }
    async onModuleInit() {
        this.logger.log('CollectorService initializing…');
        try {
            this.webSocketInit = this.moduleRef.get('WEB_SOCKET_INIT_SERVICE', {
                strict: false,
            });
            this.logger.log('WebSocketInitService resolved via ModuleRef');
        }
        catch (err) {
            this.logger.warn('WebSocketInitService not registered in DI container');
        }
        await this.mysqlRepo.ensureCollectorTable();
        this.momoStream.init((symbol, candle) => this.onCandleClosed(symbol, candle), (symbol, candle) => this.onLiveTick(symbol, candle));
        this.logger.log('🚫 MoMo stream service is DISABLED - Alpaca WebSocket + 61s fallback only');
        const persisted = await this.mysqlRepo.getActiveSymbols();
        if (persisted.length) {
            this.logger.log(`Restoring ${persisted.length} persisted symbols: ${persisted.map((s) => s.symbol).join(', ')}`);
            const BATCH = 5;
            for (let i = 0; i < persisted.length; i += BATCH) {
                const batch = persisted.slice(i, i + BATCH);
                await Promise.all(batch.map(({ symbol }) => this.addSymbol(symbol, 'restored', true)));
            }
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
        await this.migrateToAlpacaIfAvailable();
        this.logger.log(`CollectorService ready — ${this.activeSymbols.size} active symbols`);
    }
    async addSymbol(symbol, source = 'momo', skipPersist = false) {
        symbol = symbol.toUpperCase();
        if (this.activeSymbols.has(symbol))
            return;
        this.logger.log(`Adding symbol: ${symbol} (source: ${source})`);
        let metadata = {
            priorClose: 0,
            preMarketHigh: 0,
            sharesOutstanding: 0,
            marketCap: 0,
            gapPct: 0,
            premarketVolume: 0,
        };
        try {
            const snap = await this.scannerService.getStockSnapshotFromMomo(symbol, undefined, '1m');
            const priorCandles = snap.candles_1min;
            const lastClose = priorCandles.length ? priorCandles[priorCandles.length - 1].c : snap.price;
            metadata = {
                priorClose: lastClose - lastClose * snap.change_pct,
                preMarketHigh: snap.pre_market_high ?? 0,
                sharesOutstanding: 0,
                marketCap: 0,
                gapPct: snap.change_pct,
                premarketVolume: 0,
            };
        }
        catch (err) {
            this.logger.warn(`Failed to fetch metadata for ${symbol}: ${err.message}`);
        }
        const state = {
            symbol,
            metadata,
            history: [],
        };
        this.activeSymbols.set(symbol, state);
        if (!skipPersist) {
            await this.mysqlRepo.saveActiveSymbol(symbol, source);
        }
        await this.backfillFromMomo(symbol);
        const alpacaConnected = this.webSocketInit?.isAlpacaConnected() ?? false;
        if (alpacaConnected && this.webSocketInit) {
            try {
                const activeSymbols = this.getActiveSymbolList();
                await this.webSocketInit.refreshSubscriptions(activeSymbols);
                this.logger.log(`✅ ${symbol} subscribed to Alpaca WebSocket (premium)`);
            }
            catch (error) {
                this.logger.warn(`Failed to subscribe ${symbol} to Alpaca: ${error.message}`);
                this.logger.warn(`Relying on 61s historical fallback only`);
            }
        }
        else {
            this.logger.warn(`⚠️ Alpaca WebSocket not available for ${symbol} - relying on 61s historical fallback`);
        }
        this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
    }
    async backfillFromMomo(symbol) {
        if (this.isAfterHoursNow()) {
            this.logger.log(`Backfill skipped (after hours): ${symbol}`);
            return;
        }
        const state = this.activeSymbols.get(symbol);
        if (!state)
            return;
        const todayET = this.getTodayDateET();
        this.logger.log(`Backfilling ${symbol} for ${todayET}`);
        let allCandles = [];
        try {
            const url = `${this.momoBase}/ticker/chart?q=${symbol}&interval=1m`;
            const res = await axios_1.default.get(url, { timeout: 10000 });
            if (res.data?.error !== 0 || !res.data?.message?.history) {
                this.logger.warn(`MoMo returned no data for ${symbol}`);
                return;
            }
            const raw = res.data.message.history;
            allCandles = raw.slice().reverse().map(([o, h, l, c, v, t]) => ({ o, h, l, c, v, t }));
        }
        catch (err) {
            this.logger.warn(`MoMo fetch failed for ${symbol}: ${err.message}`);
            return;
        }
        const todayCandles = allCandles.filter((c) => {
            const { date } = (0, indicator_calculator_1.timestampToET)(c.t);
            return date === todayET;
        });
        if (!todayCandles.length) {
            this.logger.log(`No candles for ${symbol} today`);
            return;
        }
        state.history = todayCandles.map((c) => ({
            o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, t: c.t,
        }));
        const deleted = await this.mysqlRepo.deleteCandlesForSymbolDate(symbol, todayET);
        if (deleted > 0) {
            this.logger.log(`Deleted ${deleted} old rows for ${symbol} on ${todayET}`);
        }
        const allRows = [];
        for (let i = 0; i < state.history.length; i++) {
            const historySlice = state.history.slice(0, i + 1);
            allRows.push((0, indicator_calculator_1.computeCandleRow)(symbol, historySlice, state.metadata));
        }
        await this.mysqlRepo.bulkUpsertCandles(allRows);
        this.logger.log(`Backfilled ${symbol}: ${todayCandles.length} candles inserted clean`);
    }
    onLiveTick(symbol, candle) {
        const state = this.activeSymbols.get(symbol);
        if (!state)
            return;
        this.gateway.emitCandleLive(symbol, candle);
    }
    async onCandleClosed(symbol, candle) {
        const state = this.activeSymbols.get(symbol);
        if (!state) {
            this.logger.warn(`onCandleClosed: No state found for symbol ${symbol}`);
            return;
        }
        this.logger.log(`🕯️  onCandleClosed: ${symbol} at ${new Date(candle.t).toISOString()} close=${candle.c.toFixed(3)}`);
        const last = state.history[state.history.length - 1];
        if (last && last.t === candle.t) {
            state.history[state.history.length - 1] = candle;
        }
        else {
            state.history.push(candle);
        }
        const row = (0, indicator_calculator_1.computeCandleRow)(symbol, state.history, state.metadata);
        try {
            await this.mysqlRepo.upsertCandle(row);
            this.logger.debug(`✅ MySQL upsert successful: ${symbol} ${row.candle_time_et}`);
            this.gateway.emitCandleUpdate(row);
            this.logger.debug(`📡 Emitted to WebSocket gateway: ${symbol} ${row.candle_time_et}`);
            if (this.autoTrader) {
                this.autoTrader.onCandleClosed(row).catch((err) => this.logger.warn(`AutoTrader error: ${err.message}`));
            }
            this.logger.log(`${symbol} ${row.candle_time_et} | c=${row.close.toFixed(3)} v=${row.volume} ` +
                `vwap=${row.vwap.toFixed(3)} ema9=${row.ema9.toFixed(3)} atr=${row.atr.toFixed(3)}`);
        }
        catch (error) {
            this.logger.error(`Error processing candle for ${symbol}: ${error.message}`);
        }
    }
    async resetActiveSymbols() {
        const symbols = [...this.activeSymbols.keys()];
        if (symbols.length && this.webSocketInit) {
            try {
                await this.webSocketInit.refreshSubscriptions([]);
                this.logger.log(`🚫 Cleared all Alpaca WebSocket subscriptions`);
            }
            catch (error) {
                this.logger.warn(`Failed to clear Alpaca WebSocket subscriptions: ${error.message}`);
            }
        }
        this.activeSymbols.clear();
        await this.mysqlRepo.deactivateAllSymbols();
        this.gateway.emitSymbolsUpdate([]);
        this.logger.log('🔄 Active symbols cleared for new trading day');
    }
    async scanMomo() {
        this.logger.log('Scanning MoMo for hot tickers…');
        const url = `https://momoscreener.com/api/momo?int=5&change=3`;
        let items = [];
        try {
            const res = await axios_1.default.get(url, { timeout: 10000 });
            items = res.data?.message ?? [];
        }
        catch (err) {
            this.logger.warn(`MoMo scan failed: ${err.message}`);
            return [];
        }
        const seen = new Set();
        const newSymbols = [];
        for (const item of items) {
            const sym = (item.symbol || '').toUpperCase();
            if (!sym || seen.has(sym))
                continue;
            seen.add(sym);
            const price = item.live?.lastPrice ?? item.stats?.price ?? 0;
            const change = item.change ?? 0;
            if (price < 2 || price > 20)
                continue;
            if (change < 3)
                continue;
            if (!this.activeSymbols.has(sym)) {
                newSymbols.push(sym);
            }
        }
        for (const sym of newSymbols) {
            await this.addSymbol(sym, 'momo_scan');
            await new Promise((r) => setTimeout(r, 500));
        }
        if (newSymbols.length) {
            this.logger.log(`MoMo scan added ${newSymbols.length} new symbols: ${newSymbols.join(', ')}`);
        }
        else {
            this.logger.log(`MoMo scan: no new symbols (${this.activeSymbols.size} active)`);
        }
        return newSymbols;
    }
    async refreshAllFromMomo(options = {}) {
        if (!options.force && this.isAfterHoursNow()) {
            this.logger.log('MoMo refresh skipped (after hours)');
            return { skipped: true, reason: 'after_hours' };
        }
        const symbols = [...this.activeSymbols.keys()];
        if (!symbols.length)
            return { skipped: true, reason: 'no_active_symbols' };
        this.logger.log(`MoMo refresh: updating ${symbols.length} symbols…`);
        const todayET = this.getTodayDateET();
        for (const symbol of symbols) {
            const state = this.activeSymbols.get(symbol);
            if (!state)
                continue;
            try {
                const url = `${this.momoBase}/ticker/chart?q=${symbol}&interval=1m`;
                const res = await axios_1.default.get(url, { timeout: 10000 });
                if (res.data?.error !== 0 || !res.data?.message?.history)
                    continue;
                const raw = res.data.message.history;
                const allCandles = raw.slice().reverse().map(([o, h, l, c, v, t]) => ({ o, h, l, c, v, t }));
                const todayCandles = allCandles.filter((c) => {
                    const { date, minuteOfDay } = (0, indicator_calculator_1.timestampToET)(c.t);
                    return date === todayET && minuteOfDay >= 570 && minuteOfDay < 960;
                });
                if (!todayCandles.length)
                    continue;
                state.history = todayCandles.map((c) => ({
                    o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, t: c.t,
                }));
                let newCount = 0;
                for (let i = 0; i < state.history.length; i++) {
                    const historySlice = state.history.slice(0, i + 1);
                    const row = (0, indicator_calculator_1.computeCandleRow)(symbol, historySlice, state.metadata);
                    await this.mysqlRepo.upsertCandle(row);
                    newCount++;
                }
                this.logger.debug(`MoMo refresh ${symbol}: ${newCount} candles upserted`);
            }
            catch (err) {
                this.logger.warn(`MoMo refresh failed for ${symbol}: ${err.message}`);
            }
            await new Promise((r) => setTimeout(r, 500));
        }
        this.logger.log(`MoMo refresh complete for ${symbols.length} symbols`);
        return { skipped: false };
    }
    async migrateToAlpacaIfAvailable() {
        if (!this.webSocketInit) {
            this.logger.warn('WebSocketInitService not available - using 61s historical fallback only');
            return;
        }
        const alpacaConnected = this.webSocketInit.isAlpacaConnected();
        const activeSymbols = this.getActiveSymbolList();
        if (alpacaConnected && activeSymbols.length > 0) {
            this.logger.log(`🔄 Setting up ${activeSymbols.length} symbols on Alpaca WebSocket...`);
            try {
                await this.webSocketInit.refreshSubscriptions(activeSymbols);
                this.logger.log(`✅ ${activeSymbols.length} symbols active on Alpaca WebSocket`);
            }
            catch (error) {
                this.logger.error(`❌ Failed to setup Alpaca: ${error.message}`);
                this.logger.warn(`Relying on 61s historical fallback only`);
            }
        }
        else if (activeSymbols.length > 0) {
            this.logger.warn(`⚠️ Alpaca WebSocket not available for ${activeSymbols.length} symbols - 61s historical fallback only`);
        }
    }
    getActiveSymbolList() {
        return [...this.activeSymbols.keys()];
    }
    getDebugStatus() {
        return {
            activeSymbols: this.getActiveSymbolList(),
            subscribedSymbols: [],
            wsConnected: false,
            symbolCount: this.activeSymbols.size,
        };
    }
    async forceResubscribeAll() {
        const symbols = this.getActiveSymbolList();
        this.logger.log(`Force re-subscribing to ${symbols.length} symbols on Alpaca only: ${symbols.join(', ')}`);
        if (symbols.length > 0 && this.webSocketInit) {
            try {
                await this.webSocketInit.refreshSubscriptions(symbols);
                this.logger.log(`✅ Re-subscribed ${symbols.length} symbols to Alpaca`);
            }
            catch (error) {
                this.logger.error(`❌ Failed to re-subscribe to Alpaca: ${error.message}`);
                return { ok: false, resubscribed: [] };
            }
        }
        return { ok: true, resubscribed: symbols };
    }
    resetWebSocketStats() {
        this.momoStream.resetStats();
        this.logger.log('WebSocket statistics reset');
    }
    getWebSocketStats() {
        return this.momoStream.getStats();
    }
    getTodayDateET() {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    }
    getMinuteOfDayET() {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).formatToParts(new Date());
        const get = (type) => parts.find((p) => p.type === type)?.value ?? '0';
        const h = parseInt(get('hour'), 10);
        const m = parseInt(get('minute'), 10);
        return h * 60 + m;
    }
    isAfterHoursNow() {
        return this.getMinuteOfDayET() >= 16 * 60;
    }
};
exports.CollectorService = CollectorService;
exports.CollectorService = CollectorService = CollectorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(5, (0, common_1.Optional)()),
    __param(5, (0, common_1.Inject)(auto_trader_service_1.AutoTraderService)),
    __metadata("design:paramtypes", [core_1.ModuleRef,
        mysql_training_repository_1.MysqlTrainingRepository,
        scanner_service_1.ScannerService,
        momo_stream_service_1.MomoStreamService,
        collector_gateway_1.CollectorGateway,
        auto_trader_service_1.AutoTraderService])
], CollectorService);
//# sourceMappingURL=collector.service.js.map