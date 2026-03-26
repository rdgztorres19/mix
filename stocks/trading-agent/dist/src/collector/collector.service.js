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
var CollectorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectorService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const mysql_training_repository_1 = require("../scanner/mysql/mysql-training.repository");
const alpaca_datasource_1 = require("../scanner/datasource/alpaca-datasource");
const scanner_service_1 = require("../scanner/scanner.service");
const momo_stream_service_1 = require("./momo-stream.service");
const collector_gateway_1 = require("./collector.gateway");
const auto_trader_service_1 = require("../trader/auto-trader.service");
const training_row_builder_1 = require("../training/training-row-builder");
const premarket_volume_feature_1 = require("../training/premarket-volume.feature");
const fundamental_cache_service_1 = require("../training/fundamental-cache.service");
const indicator_calculator_1 = require("./indicator.calculator");
const top_gainers_source_service_1 = require("./top-gainers-source.service");
const scanned_tracker_service_1 = require("./tracker/scanned-tracker.service");
let CollectorService = CollectorService_1 = class CollectorService {
    constructor(moduleRef, mysqlRepo, alpacaDataSource, scannerService, momoStream, gateway, topGainersSource, scannedTracker, fundamentalCache, autoTrader) {
        this.moduleRef = moduleRef;
        this.mysqlRepo = mysqlRepo;
        this.alpacaDataSource = alpacaDataSource;
        this.scannerService = scannerService;
        this.momoStream = momoStream;
        this.gateway = gateway;
        this.topGainersSource = topGainersSource;
        this.scannedTracker = scannedTracker;
        this.fundamentalCache = fundamentalCache;
        this.autoTrader = autoTrader;
        this.logger = new common_1.Logger(CollectorService_1.name);
        this.symbols = new Map();
        this.activeSymbols = new Set();
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
        const persisted = await this.mysqlRepo.getActiveSymbols();
        if (persisted.length) {
            this.logger.log(`Restoring ${persisted.length} persisted symbols: ${persisted.map((s) => s.symbol).join(', ')}`);
            const BATCH = 5;
            for (let i = 0; i < persisted.length; i += BATCH) {
                const batch = persisted.slice(i, i + BATCH);
                await Promise.all(batch.map(({ symbol }) => this.addSymbolToCollection(symbol, 'restored', true)));
            }
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
        await this.migrateToAlpacaIfAvailable();
        this.logger.log(`CollectorService ready — ${this.symbols.size} symbols, ${this.activeSymbols.size} active (trading)`);
    }
    async addSymbolToCollection(symbol, source = 'cron', skipPersist = false) {
        symbol = symbol.toUpperCase();
        if (this.symbols.has(symbol))
            return;
        this.logger.log(`Adding symbol to collection: ${symbol} (source: ${source})`);
        const todayET = this.getTodayDateET();
        const result = await this._syncSymbolDateCore(symbol, todayET);
        if (!result.ok || !result.candles || !result.metadata) {
            this.logger.warn(`addSymbolToCollection: ${symbol} - ${result.error ?? 'no data'}`);
            return;
        }
        const state = {
            symbol,
            metadata: result.metadata,
            history: result.candles,
        };
        this.symbols.set(symbol, state);
        if (!skipPersist) {
            await this.mysqlRepo.saveActiveSymbol(symbol, source);
        }
        this.scannedTracker.trackNewSymbol(symbol).catch(e => this.logger.warn(`ScannedTracker error for ${symbol}: ${e.message}`));
        if (this.webSocketInit?.isAlpacaConnected() && this.webSocketInit) {
            try {
                await this.webSocketInit.refreshSubscriptions(this.getSymbolsList());
                this.logger.log(`✅ ${symbol} subscribed to Alpaca WebSocket`);
            }
            catch (error) {
                this.logger.warn(`Failed to subscribe ${symbol} to Alpaca: ${error.message}`);
            }
        }
        this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
    }
    onLiveTick(symbol, candle) {
        const state = this.symbols.get(symbol);
        if (!state)
            return;
        this.gateway.emitCandleLive(symbol, candle);
    }
    async onCandleClosed(symbol, candle) {
        const state = this.symbols.get(symbol);
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
            if (this.autoTrader && this.activeSymbols.has(symbol)) {
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
        const symbolList = this.getSymbolsList();
        if (symbolList.length && this.webSocketInit) {
            try {
                await this.webSocketInit.refreshSubscriptions([]);
                this.logger.log(`🚫 Cleared all Alpaca WebSocket subscriptions`);
            }
            catch (error) {
                this.logger.warn(`Failed to clear Alpaca WebSocket subscriptions: ${error.message}`);
            }
        }
        this.symbols.clear();
        this.activeSymbols.clear();
        await this.mysqlRepo.deactivateAllSymbols();
        this.gateway.emitSymbolsUpdate([]);
        this.logger.log('🔄 Symbols and activeSymbols cleared');
    }
    async runTopGainersCron() {
        const source = (0, top_gainers_source_service_1.getTopGainerSourceFromEnv)();
        const fetched = await this.topGainersSource.fetchSymbols(source);
        if (!fetched.length) {
            this.logger.debug('Top gainers cron: no symbols from source');
            return;
        }
        this.logger.log(`Top gainers cron (${source}): ${fetched.length} symbols`);
        this.activeSymbols.clear();
        for (const s of fetched)
            this.activeSymbols.add(s.toUpperCase());
        const toAdd = fetched.filter((s) => !this.symbols.has(s.toUpperCase()));
        for (const symbol of toAdd) {
            try {
                await this.addSymbolToCollection(symbol, `cron_${source}`, false);
            }
            catch (err) {
                this.logger.warn(`Cron add ${symbol} failed: ${err.message}`);
            }
            await new Promise((r) => setTimeout(r, 200));
        }
        if (this.webSocketInit) {
            try {
                await this.webSocketInit.refreshSubscriptions(this.getSymbolsList());
            }
            catch (err) {
                this.logger.warn(`Cron refresh subscriptions failed: ${err.message}`);
            }
        }
        await this.mysqlRepo.deactivateAllSymbols();
        for (const s of this.activeSymbols) {
            await this.mysqlRepo.saveActiveSymbol(s, `cron_${source}`);
        }
        this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
    }
    async scanMomo() {
        this.logger.warn('scanMomo is deprecated, use runTopGainersCron');
        await this.runTopGainersCron();
        return this.getActiveSymbolList();
    }
    async refreshAllFromMomo() {
        this.logger.warn('refreshAllFromMomo is deprecated');
        return { skipped: true, reason: 'deprecated' };
    }
    async migrateToAlpacaIfAvailable() {
        if (!this.webSocketInit) {
            this.logger.warn('WebSocketInitService not available - using 61s historical fallback only');
            return;
        }
        const alpacaConnected = this.webSocketInit.isAlpacaConnected();
        const symbolList = this.getSymbolsList();
        if (alpacaConnected && symbolList.length > 0) {
            this.logger.log(`🔄 Setting up ${symbolList.length} symbols on Alpaca WebSocket...`);
            try {
                await this.webSocketInit.refreshSubscriptions(symbolList);
                this.logger.log(`✅ ${symbolList.length} symbols active on Alpaca WebSocket`);
            }
            catch (error) {
                this.logger.error(`❌ Failed to setup Alpaca: ${error.message}`);
                this.logger.warn(`Relying on 61s historical fallback only`);
            }
        }
        else if (symbolList.length > 0) {
            this.logger.warn(`⚠️ Alpaca WebSocket not available for ${symbolList.length} symbols - 61s historical fallback only`);
        }
    }
    getSymbolsList() {
        return [...this.symbols.keys()];
    }
    getActiveSymbolList() {
        return [...this.symbols.keys()];
    }
    getDebugStatus() {
        const symbolList = this.getSymbolsList();
        return {
            activeSymbols: this.getActiveSymbolList(),
            subscribedSymbols: symbolList,
            symbols: symbolList,
            wsConnected: this.webSocketInit?.isAlpacaConnected() ?? false,
            symbolCount: this.symbols.size,
        };
    }
    async reloadMissingSymbolsFromDb() {
        const persisted = await this.mysqlRepo.getActiveSymbols();
        const toAdd = persisted.filter((s) => !this.symbols.has(s.symbol));
        for (const { symbol } of toAdd) {
            await this.addSymbolToCollection(symbol, 'restored', true);
        }
        if (toAdd.length > 0) {
            this.logger.log(`📥 Reloaded ${toAdd.length} missing symbols from DB: ${toAdd.map((s) => s.symbol).join(', ')}`);
        }
        return toAdd.length;
    }
    async forceResubscribeAll() {
        await this.reloadMissingSymbolsFromDb();
        const symbolList = this.getSymbolsList();
        this.logger.log(`Force re-subscribing to ${symbolList.length} symbols on Alpaca: ${symbolList.join(', ')}`);
        if (symbolList.length > 0 && this.webSocketInit) {
            try {
                await this.webSocketInit.refreshSubscriptions(symbolList);
                this.logger.log(`✅ Re-subscribed ${symbolList.length} symbols to Alpaca`);
            }
            catch (error) {
                this.logger.error(`❌ Failed to re-subscribe to Alpaca: ${error.message}`);
                return { ok: false, resubscribed: [] };
            }
        }
        return { ok: true, resubscribed: symbolList };
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
    async _syncSymbolDateCore(symbol, dateStr) {
        symbol = symbol.toUpperCase();
        const candles = await this.alpacaDataSource.fetch1mBarsForDate(symbol, dateStr);
        if (!candles.length) {
            return { ok: false, rows: 0, error: 'no_data' };
        }
        const trainingCandles = candles.map((c) => ({ ...c }));
        const prevDate = this.prevTradingDay(dateStr);
        let priorClose = 0;
        try {
            const prevBars = await this.alpacaDataSource.fetch1mBarsForDate(symbol, prevDate);
            if (prevBars.length) {
                priorClose = prevBars[prevBars.length - 1].c;
            }
        }
        catch {
            priorClose = trainingCandles[0]?.o ?? trainingCandles[0]?.c ?? 0;
        }
        if (priorClose <= 0) {
            priorClose = trainingCandles[0]?.o ?? trainingCandles[0]?.c ?? 0;
        }
        const openDay = trainingCandles[0].o;
        const firstRegular = trainingCandles.find((c) => {
            const { minuteOfDay } = (0, indicator_calculator_1.timestampToET)(c.t);
            return minuteOfDay >= 9 * 60 + 30;
        });
        const openFirst = firstRegular?.o ?? openDay;
        const premarketVolume = (0, premarket_volume_feature_1.computePremarketVolume)(trainingCandles);
        const preMarketCandles = trainingCandles.filter((c) => {
            const { minuteOfDay } = (0, indicator_calculator_1.timestampToET)(c.t);
            return minuteOfDay < 9 * 60 + 30;
        });
        const preMarketHigh = preMarketCandles.length
            ? Math.max(...preMarketCandles.map((c) => c.h))
            : null;
        const fundamentals = await this.fundamentalCache.getFundamentals(symbol);
        const metadata = {
            priorClose,
            preMarketHigh: preMarketHigh ?? 0,
            sharesOutstanding: fundamentals.sharesOutstanding ?? null,
            marketCap: fundamentals.marketCap ?? null,
            gapPct: priorClose > 0 ? (openFirst - priorClose) / priorClose : 0,
            premarketVolume,
        };
        await this.mysqlRepo.deleteCandlesForSymbolDate(symbol, dateStr);
        const rows = [];
        for (let i = 0; i < trainingCandles.length; i++) {
            const row = (0, training_row_builder_1.buildTrainingRow)({
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
            });
            rows.push(row);
        }
        await this.mysqlRepo.bulkUpsertCandles(rows);
        const collectorCandles = trainingCandles.map((c) => ({
            o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, t: c.t,
        }));
        return { ok: true, rows: rows.length, candles: collectorCandles, metadata };
    }
    async syncSymbolDate(symbol, dateStr) {
        symbol = symbol.toUpperCase();
        try {
            this.logger.log(`syncSymbolDate: ${symbol} ${dateStr}`);
            const result = await this._syncSymbolDateCore(symbol, dateStr);
            if (result.ok) {
                this.logger.log(`syncSymbolDate: ${symbol} ${dateStr} inserted ${result.rows} rows`);
            }
            return { ok: result.ok, rows: result.rows, error: result.error };
        }
        catch (err) {
            const msg = err.message;
            this.logger.error(`syncSymbolDate failed for ${symbol} ${dateStr}: ${msg}`);
            return { ok: false, rows: 0, error: msg };
        }
    }
    async syncTodayFromSource(source) {
        const symbols = await this.topGainersSource.fetchSymbols(source);
        if (!symbols.length) {
            this.logger.warn('Sync today: no symbols from source');
            return { ok: false, symbols: 0, totalRows: 0, skipped: true, reason: 'no_symbols' };
        }
        this.logger.log(`Sync today from ${source}: ${symbols.length} symbols`);
        const todayET = this.getTodayDateET();
        const deleted = await this.mysqlRepo.deleteCandlesForDate(todayET);
        if (deleted > 0) {
            this.logger.log(`Cleared ${deleted} existing rows for today before sync`);
        }
        await this.resetActiveSymbols();
        let totalRows = 0;
        for (const symbol of symbols) {
            const sym = symbol.toUpperCase();
            try {
                const result = await this._syncSymbolDateCore(sym, todayET);
                if (result.ok && result.candles && result.metadata) {
                    totalRows += result.rows;
                    const state = {
                        symbol: sym,
                        metadata: result.metadata,
                        history: result.candles,
                    };
                    this.symbols.set(sym, state);
                    this.activeSymbols.add(sym);
                    await this.mysqlRepo.saveActiveSymbol(sym, `sync_${source}`);
                }
                else if (result.error) {
                    this.logger.warn(`Sync today: ${sym} - ${result.error}`);
                }
            }
            catch (err) {
                this.logger.warn(`Sync today failed for ${sym}: ${err.message}`);
            }
            await new Promise((r) => setTimeout(r, 300));
        }
        if (this.symbols.size > 0 && this.webSocketInit) {
            try {
                await this.webSocketInit.refreshSubscriptions(this.getSymbolsList());
                this.logger.log(`✅ Subscribed ${this.symbols.size} symbols to Alpaca WebSocket`);
            }
            catch (err) {
                this.logger.warn(`Failed to subscribe to Alpaca: ${err.message}`);
            }
        }
        this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
        this.logger.log(`Sync today complete: ${this.activeSymbols.size} active, ${totalRows} rows`);
        return { ok: true, symbols: this.activeSymbols.size, totalRows };
    }
    async syncDate(dateStr) {
        const symbols = await this.mysqlRepo.getSymbolsForDate(dateStr);
        if (!symbols.length) {
            this.logger.warn(`syncDate: no symbols found in DB for ${dateStr}`);
            return { ok: false, symbols: 0, totalRows: 0, errors: ['no symbols in DB for this date'] };
        }
        this.logger.log(`syncDate: syncing ${symbols.length} symbols for ${dateStr}`);
        const errors = [];
        let totalRows = 0;
        for (const symbol of symbols) {
            try {
                const result = await this.syncSymbolDate(symbol, dateStr);
                if (result.ok) {
                    totalRows += result.rows;
                }
                else if (result.error) {
                    errors.push(`${symbol}: ${result.error}`);
                }
            }
            catch (err) {
                const msg = err.message;
                errors.push(`${symbol}: ${msg}`);
            }
            await new Promise((r) => setTimeout(r, 300));
        }
        const ok = errors.length === 0;
        this.logger.log(`syncDate: ${dateStr} done — ${symbols.length} symbols, ${totalRows} rows${errors.length ? `, ${errors.length} errors` : ''}`);
        return { ok, symbols: symbols.length, totalRows, errors };
    }
    prevTradingDay(dateStr) {
        const d = new Date(dateStr + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        const dow = d.getUTCDay();
        if (dow === 0)
            d.setUTCDate(d.getUTCDate() - 2);
        else if (dow === 6)
            d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
    }
};
exports.CollectorService = CollectorService;
exports.CollectorService = CollectorService = CollectorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(9, (0, common_1.Optional)()),
    __param(9, (0, common_1.Inject)(auto_trader_service_1.AutoTraderService)),
    __metadata("design:paramtypes", [core_1.ModuleRef,
        mysql_training_repository_1.MysqlTrainingRepository,
        alpaca_datasource_1.AlpacaDataSource,
        scanner_service_1.ScannerService,
        momo_stream_service_1.MomoStreamService,
        collector_gateway_1.CollectorGateway,
        top_gainers_source_service_1.TopGainersSourceService,
        scanned_tracker_service_1.ScannedTrackerService,
        fundamental_cache_service_1.FundamentalCacheService,
        auto_trader_service_1.AutoTraderService])
], CollectorService);
//# sourceMappingURL=collector.service.js.map