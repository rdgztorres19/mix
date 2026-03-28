/**
 * CollectorService — real-time market data collection orchestrator.
 *
 * Sections:
 *  1. Lifecycle          – NestJS init, WebSocket resolution
 *  2. Watchlist          – add / remove / reset tracked symbols
 *  3. Real-time candles  – process live 1m bars from Alpaca stream
 *  4. Scanning           – top-gainers cron, DB reload
 *  5. Historical sync    – backfill symbol+date from Alpaca REST
 *  6. WebSocket wiring   – subscribe / refresh Alpaca WS
 *  7. Queries            – read-only accessors for state & debug
 *  8. Helpers            – time, date, prev trading day
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CollectorService", {
    enumerable: true,
    get: function() {
        return CollectorService;
    }
});
const _common = require("@nestjs/common");
const _core = require("@nestjs/core");
const _mysqltrainingrepository = require("../scanner/mysql/mysql-training.repository");
const _alpacadatasource = require("../scanner/datasource/alpaca-datasource");
const _scannerservice = require("../scanner/scanner.service");
const _collectorgateway = require("./collector.gateway");
const _autotraderservice = require("../trader/auto-trader.service");
const _trainingrowbuilder = require("../training/training-row-builder");
const _premarketvolumefeature = require("../training/premarket-volume.feature");
const _fundamentalcacheservice = require("../training/fundamental-cache.service");
const _indicatorcalculator = require("./indicator.calculator");
const _topgainerssourceservice = require("./top-gainers-source.service");
const _scannedtrackerservice = require("./tracker/scanned-tracker.service");
const _promisepool = require("@supercharge/promise-pool");
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
let CollectorService = class CollectorService {
    // ═══════════════════════════════════════════════════════════════════════════
    // 1. Lifecycle
    // ═══════════════════════════════════════════════════════════════════════════
    async onModuleInit() {
        this.logger.log('CollectorService initializing…');
        this.resolveWebSocketService();
        await this.mysqlRepo.ensureCollectorTable();
        await this.reloadMissingSymbolsFromDb();
        // Brief pause so the WS has time to authenticate before we subscribe
        await new Promise((resolve)=>setTimeout(resolve, 3000));
        await this.ensureAlpacaSubscriptions();
        this.logger.log(`CollectorService ready — ${this.symbols.size} symbols, ${this.activeSymbols.size} active (trading)`);
    }
    resolveWebSocketService() {
        try {
            this.webSocketInit = this.moduleRef.get('WEB_SOCKET_INIT_SERVICE', {
                strict: false
            });
            this.logger.log('WebSocketInitService resolved via ModuleRef');
        } catch  {
            this.logger.warn('WebSocketInitService not registered in DI container');
        }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // 2. Watchlist management
    // ═══════════════════════════════════════════════════════════════════════════
    /**
   * Add a symbol to the collection: backfill today's candles from Alpaca,
   * store state in memory, persist to DB, and subscribe to real-time stream.
   */ async addSymbolToCollection(symbol, source = 'cron', skipPersist = false) {
        symbol = symbol.toUpperCase();
        if (this.symbols.has(symbol)) return;
        this.logger.log(`Adding symbol to collection: ${symbol} (source: ${source})`);
        const todayET = this.todayET();
        const result = await this.fetchAndBuildCandles(symbol, todayET);
        if (!result.ok || !result.candles || !result.metadata) {
            this.logger.warn(`addSymbolToCollection: ${symbol} - ${result.error ?? 'no data'}`);
            return;
        }
        this.symbols.set(symbol, {
            symbol,
            metadata: result.metadata,
            history: result.candles
        });
        if (!skipPersist) {
            await this.mysqlRepo.saveActiveSymbol(symbol, source);
        }
        this.scannedTracker.trackNewSymbol(symbol).catch((e)=>this.logger.warn(`ScannedTracker error for ${symbol}: ${e.message}`));
        await this.subscribeSymbol(symbol);
        this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
    }
    /**
   * Bulk-add symbols to collection in parallel (concurrency-limited).
   * Skips per-symbol WS refresh and gateway emit — caller handles those once at the end.
   */ async addSymbolsBulk(symbols, concurrency = 15) {
        const { errors } = await _promisepool.PromisePool.for(symbols).withConcurrency(concurrency).process(async ({ symbol, source, skipPersist })=>{
            const sym = symbol.toUpperCase();
            if (this.symbols.has(sym)) return;
            this.logger.log(`Adding symbol: ${sym} (source: ${source})`);
            const result = await this.fetchAndBuildCandles(sym, this.todayET());
            if (!result.ok || !result.candles || !result.metadata) {
                this.logger.warn(`addSymbolsBulk: ${sym} - ${result.error ?? 'no data'}`);
                return;
            }
            this.symbols.set(sym, {
                symbol: sym,
                metadata: result.metadata,
                history: result.candles
            });
            if (!skipPersist) {
                await this.mysqlRepo.saveActiveSymbol(sym, source);
            }
            this.scannedTracker.trackNewSymbol(sym).catch((e)=>this.logger.warn(`ScannedTracker error for ${sym}: ${e.message}`));
        });
        for (const err of errors){
            this.logger.warn(`Bulk add failed: ${err.message}`);
        }
        return symbols.length - errors.length;
    }
    /**
   * Clear the entire watchlist and unsubscribe from all streams.
   */ async resetActiveSymbols() {
        if (this.getSymbolsList().length && this.webSocketInit) {
            await this.safeRefreshSubscriptions([]);
        }
        this.symbols.clear();
        this.activeSymbols.clear();
        await this.mysqlRepo.deactivateAllSymbols();
        this.gateway.emitSymbolsUpdate([]);
        this.logger.log('Watchlist cleared');
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // 3. Real-time candle processing
    // ═══════════════════════════════════════════════════════════════════════════
    /**
   * Process a closed 1-minute candle from the Alpaca real-time stream.
   * Updates history, computes indicators, persists to MySQL, pushes to UI,
   * and triggers auto-trader prediction for active (trading) symbols.
   */ async onCandleClosed(symbol, candle) {
        const state = this.symbols.get(symbol);
        if (!state) {
            this.logger.warn(`onCandleClosed: no state for ${symbol}`);
            return;
        }
        this.logger.log(`🕯️  onCandleClosed: ${symbol} at ${new Date(candle.t).toISOString()} close=${candle.c.toFixed(3)}`);
        this.appendOrReplaceCandle(state, candle);
        const row = (0, _indicatorcalculator.computeCandleRow)(symbol, state.history, state.metadata);
        try {
            await this.persistCandle(row);
            this.broadcastCandle(row);
            this.maybeTriggerAutoTrader(symbol, row);
            this.logger.log(`${symbol} ${row.candle_time_et} | c=${row.close.toFixed(3)} v=${row.volume} ` + `vwap=${row.vwap.toFixed(3)} ema9=${row.ema9.toFixed(3)} atr=${row.atr.toFixed(3)}`);
        } catch (error) {
            this.logger.error(`Error processing candle for ${symbol}: ${error.message}`);
        }
    }
    appendOrReplaceCandle(state, candle) {
        const last = state.history[state.history.length - 1];
        if (last && last.t === candle.t) {
            state.history[state.history.length - 1] = candle;
        } else {
            state.history.push(candle);
        }
    }
    async persistCandle(row) {
        await this.mysqlRepo.upsertCandle(row);
        this.logger.debug(`MySQL upsert: ${row.symbol} ${row.candle_time_et}`);
    }
    broadcastCandle(row) {
        this.gateway.emitCandleUpdate(row);
        this.logger.debug(`WS emit: ${row.symbol} ${row.candle_time_et}`);
    }
    maybeTriggerAutoTrader(symbol, row) {
        if (this.autoTrader && this.activeSymbols.has(symbol)) {
            this.autoTrader.onCandleClosed(row).catch((err)=>this.logger.warn(`AutoTrader error: ${err.message}`));
        }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // 4. Scanning (cron + DB reload)
    // ═══════════════════════════════════════════════════════════════════════════
    /**
   * Cron job: fetch the latest top-gainers list, replace activeSymbols,
   * and backfill any new symbols from Alpaca.
   */ async runTopGainersCron() {
        const source = (0, _topgainerssourceservice.getTopGainerSourceFromEnv)();
        const fetched = await this.topGainersSource.fetchSymbols(source);
        if (!fetched.length) {
            this.logger.debug('Top gainers cron: no symbols from source');
            return;
        }
        this.logger.log(`Top gainers cron (${source}): ${fetched.length} symbols`);
        this.replaceActiveSymbols(fetched);
        await this.backfillNewSymbols(fetched, `cron_${source}`);
        await this.safeRefreshSubscriptions(this.getSymbolsList());
        await this.persistActiveSymbols(`cron_${source}`);
        this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
    }
    /**
   * Restore symbols persisted in DB that are missing from the in-memory map.
   * Time-gated to 4 AM – 12 PM ET to avoid overnight fetches.
   */ async reloadMissingSymbolsFromDb() {
        if (!this.isWithinRestoreWindow()) {
            const now = this.nowET();
            this.logger.log(`Skipping symbol restore — outside 4AM-12PM ET window (current: ${now.hours}:${String(now.minutes).padStart(2, '0')} ET)`);
            return 0;
        }
        const persisted = await this.mysqlRepo.getActiveSymbols();
        const missing = persisted.filter((s)=>!this.symbols.has(s.symbol));
        if (!missing.length) return 0;
        this.logger.log(`Restoring ${missing.length} symbols from DB: ${missing.map((s)=>s.symbol).join(', ')}`);
        const added = await this.addSymbolsBulk(missing.map((s)=>({
                symbol: s.symbol,
                source: 'restored',
                skipPersist: true
            })));
        await this.safeRefreshSubscriptions(this.getSymbolsList());
        this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
        this.logger.log(`Restored ${added}/${missing.length} symbols`);
        return added;
    }
    /**
   * Force re-subscription to Alpaca WebSocket for all symbols.
   */ async forceResubscribeAll() {
        await this.reloadMissingSymbolsFromDb();
        const symbolList = this.getSymbolsList();
        this.logger.log(`Force re-subscribing ${symbolList.length} symbols to Alpaca`);
        if (symbolList.length > 0 && this.webSocketInit) {
            try {
                await this.webSocketInit.refreshSubscriptions(symbolList);
            } catch (error) {
                this.logger.error(`Failed to re-subscribe: ${error.message}`);
                return {
                    ok: false,
                    resubscribed: []
                };
            }
        }
        return {
            ok: true,
            resubscribed: symbolList
        };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // 5. Historical sync (backfill from Alpaca REST)
    // ═══════════════════════════════════════════════════════════════════════════
    /**
   * Sync a single symbol+date: fetch 1m bars from Alpaca, rebuild training rows.
   */ async syncSymbolDate(symbol, dateStr) {
        symbol = symbol.toUpperCase();
        try {
            this.logger.log(`syncSymbolDate: ${symbol} ${dateStr}`);
            const result = await this.fetchAndBuildCandles(symbol, dateStr);
            if (result.ok) {
                this.logger.log(`syncSymbolDate: ${symbol} ${dateStr} → ${result.rows} rows`);
            }
            return {
                ok: result.ok,
                rows: result.rows,
                error: result.error
            };
        } catch (err) {
            const msg = err.message;
            this.logger.error(`syncSymbolDate failed ${symbol} ${dateStr}: ${msg}`);
            return {
                ok: false,
                rows: 0,
                error: msg
            };
        }
    }
    /**
   * Sync ALL symbols in DB for a given date: re-fetch and rebuild each.
   */ async syncDate(dateStr) {
        const symbols = await this.mysqlRepo.getSymbolsForDate(dateStr);
        if (!symbols.length) {
            this.logger.warn(`syncDate: no symbols in DB for ${dateStr}`);
            return {
                ok: false,
                symbols: 0,
                totalRows: 0,
                errors: [
                    'no symbols in DB for this date'
                ]
            };
        }
        this.logger.log(`syncDate: ${symbols.length} symbols for ${dateStr}`);
        const errors = [];
        let totalRows = 0;
        const { errors: poolErrors } = await _promisepool.PromisePool.for(symbols).withConcurrency(10).process(async (symbol)=>{
            const result = await this.syncSymbolDate(symbol, dateStr);
            if (result.ok) totalRows += result.rows;
            else if (result.error) errors.push(`${symbol}: ${result.error}`);
        });
        for (const err of poolErrors){
            errors.push(err.message);
        }
        this.logger.log(`syncDate: ${dateStr} done — ${symbols.length} symbols, ${totalRows} rows` + (errors.length ? `, ${errors.length} errors` : ''));
        return {
            ok: errors.length === 0,
            symbols: symbols.length,
            totalRows,
            errors
        };
    }
    /**
   * Sync today: fetch top gainers from a source, reset watchlist, backfill each from Alpaca.
   */ async syncTodayFromSource(source) {
        const symbols = await this.topGainersSource.fetchSymbols(source);
        if (!symbols.length) {
            this.logger.warn('syncToday: no symbols from source');
            return {
                ok: false,
                symbols: 0,
                totalRows: 0,
                skipped: true,
                reason: 'no_symbols'
            };
        }
        this.logger.log(`syncToday (${source}): ${symbols.length} symbols`);
        const todayET = this.todayET();
        await this.clearTodayCandles(todayET);
        await this.resetActiveSymbols();
        const totalRows = await this.backfillAndActivateSymbols(symbols, todayET, source);
        await this.safeRefreshSubscriptions(this.getSymbolsList());
        this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
        this.logger.log(`syncToday complete: ${this.activeSymbols.size} active, ${totalRows} rows`);
        return {
            ok: true,
            symbols: this.activeSymbols.size,
            totalRows
        };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // 6. WebSocket wiring
    // ═══════════════════════════════════════════════════════════════════════════
    async ensureAlpacaSubscriptions() {
        if (!this.webSocketInit) {
            this.logger.warn('WebSocketInitService not available — historical fallback only');
            return;
        }
        const symbolList = this.getSymbolsList();
        if (!this.webSocketInit.isAlpacaConnected() || symbolList.length === 0) {
            if (symbolList.length > 0) {
                this.logger.warn(`Alpaca WS not connected for ${symbolList.length} symbols — fallback only`);
            }
            return;
        }
        await this.safeRefreshSubscriptions(symbolList);
    }
    async subscribeSymbol(symbol) {
        if (!this.webSocketInit?.isAlpacaConnected()) return;
        try {
            await this.webSocketInit.refreshSubscriptions(this.getSymbolsList());
            this.logger.log(`${symbol} subscribed to Alpaca WS`);
        } catch (error) {
            this.logger.warn(`Failed to subscribe ${symbol}: ${error.message}`);
        }
    }
    async safeRefreshSubscriptions(symbols) {
        if (!this.webSocketInit) return;
        try {
            await this.webSocketInit.refreshSubscriptions(symbols);
            this.logger.log(`Alpaca WS subscriptions refreshed (${symbols.length} symbols)`);
        } catch (err) {
            this.logger.warn(`WS subscription refresh failed: ${err.message}`);
        }
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // 7. Queries (read-only)
    // ═══════════════════════════════════════════════════════════════════════════
    getSymbolsList() {
        return [
            ...this.symbols.keys()
        ];
    }
    getActiveSymbolList() {
        return [
            ...this.symbols.keys()
        ];
    }
    getDebugStatus() {
        const symbolList = this.getSymbolsList();
        return {
            activeSymbols: this.getActiveSymbolList(),
            subscribedSymbols: symbolList,
            symbols: symbolList,
            wsConnected: this.webSocketInit?.isAlpacaConnected() ?? false,
            symbolCount: this.symbols.size
        };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    // 8. Private helpers
    // ═══════════════════════════════════════════════════════════════════════════
    // ── Data fetching & building ──────────────────────────────────────────────
    /**
   * Fetch 1m bars from Alpaca for symbol+date, compute metadata,
   * build training rows, persist to MySQL. Returns candles + metadata for state.
   */ async fetchAndBuildCandles(symbol, dateStr) {
        symbol = symbol.toUpperCase();
        const candles = await this.alpacaDataSource.fetch1mBarsForDate(symbol, dateStr);
        if (!candles.length) return {
            ok: false,
            rows: 0,
            error: 'no_data'
        };
        const trainingCandles = candles.map((c)=>({
                ...c
            }));
        const priorClose = await this.fetchPriorClose(symbol, dateStr, trainingCandles);
        const metadata = await this.buildMetadata(symbol, trainingCandles, priorClose);
        await this.mysqlRepo.deleteCandlesForSymbolDate(symbol, dateStr);
        const rows = this.buildTrainingRows(symbol, dateStr, trainingCandles, priorClose, metadata);
        await this.mysqlRepo.bulkUpsertCandles(rows);
        const collectorCandles = trainingCandles.map((c)=>({
                o: c.o,
                h: c.h,
                l: c.l,
                c: c.c,
                v: c.v,
                t: c.t
            }));
        return {
            ok: true,
            rows: rows.length,
            candles: collectorCandles,
            metadata
        };
    }
    async fetchPriorClose(symbol, dateStr, todayCandles) {
        const fallback = todayCandles[0]?.o ?? todayCandles[0]?.c ?? 0;
        try {
            const prevBars = await this.alpacaDataSource.fetch1mBarsForDate(symbol, this.prevTradingDay(dateStr));
            if (prevBars.length) return prevBars[prevBars.length - 1].c;
        } catch  {}
        return fallback > 0 ? fallback : 0;
    }
    async buildMetadata(symbol, candles, priorClose) {
        const openDay = candles[0].o;
        const firstRegular = candles.find((c)=>(0, _indicatorcalculator.timestampToET)(c.t).minuteOfDay >= 9 * 60 + 30);
        const openFirst = firstRegular?.o ?? openDay;
        const premarketVolume = (0, _premarketvolumefeature.computePremarketVolume)(candles);
        const preMarketHigh = this.computePremarketHigh(candles);
        const fundamentals = await this.fundamentalCache.getFundamentals(symbol);
        return {
            priorClose,
            preMarketHigh: preMarketHigh ?? 0,
            sharesOutstanding: fundamentals.sharesOutstanding ?? null,
            marketCap: fundamentals.marketCap ?? null,
            gapPct: priorClose > 0 ? (openFirst - priorClose) / priorClose : 0,
            premarketVolume
        };
    }
    computePremarketHigh(candles) {
        const pmCandles = candles.filter((c)=>(0, _indicatorcalculator.timestampToET)(c.t).minuteOfDay < 9 * 60 + 30);
        return pmCandles.length ? Math.max(...pmCandles.map((c)=>c.h)) : null;
    }
    buildTrainingRows(symbol, dateStr, candles, priorClose, metadata) {
        const openDay = candles[0].o;
        const firstRegular = candles.find((c)=>(0, _indicatorcalculator.timestampToET)(c.t).minuteOfDay >= 9 * 60 + 30);
        const openFirst = firstRegular?.o ?? openDay;
        return candles.map((_, idx)=>(0, _trainingrowbuilder.buildTrainingRow)({
                symbol,
                date: dateStr,
                candles,
                idx,
                priorClose,
                openDay,
                openFirst,
                premarketVolume: metadata.premarketVolume,
                preMarketHigh: metadata.preMarketHigh || null,
                sharesOutstanding: metadata.sharesOutstanding,
                marketCap: metadata.marketCap
            }));
    }
    // ── Watchlist helpers ─────────────────────────────────────────────────────
    replaceActiveSymbols(symbols) {
        this.activeSymbols.clear();
        for (const s of symbols)this.activeSymbols.add(s.toUpperCase());
    }
    async backfillNewSymbols(symbols, source) {
        const newSymbols = symbols.filter((s)=>!this.symbols.has(s.toUpperCase()));
        if (!newSymbols.length) return;
        await this.addSymbolsBulk(newSymbols.map((s)=>({
                symbol: s,
                source,
                skipPersist: false
            })));
    }
    async persistActiveSymbols(source) {
        await this.mysqlRepo.deactivateAllSymbols();
        for (const s of this.activeSymbols){
            await this.mysqlRepo.saveActiveSymbol(s, source);
        }
    }
    async backfillAndActivateSymbols(symbols, dateStr, source) {
        let totalRows = 0;
        const { errors } = await _promisepool.PromisePool.for(symbols).withConcurrency(15).process(async (rawSymbol)=>{
            const sym = rawSymbol.toUpperCase();
            const result = await this.fetchAndBuildCandles(sym, dateStr);
            if (result.ok && result.candles && result.metadata) {
                totalRows += result.rows;
                this.symbols.set(sym, {
                    symbol: sym,
                    metadata: result.metadata,
                    history: result.candles
                });
                this.activeSymbols.add(sym);
                await this.mysqlRepo.saveActiveSymbol(sym, `sync_${source}`);
            } else if (result.error) {
                this.logger.warn(`syncToday: ${sym} - ${result.error}`);
            }
        });
        for (const err of errors){
            this.logger.warn(`syncToday failed: ${err.message}`);
        }
        return totalRows;
    }
    async clearTodayCandles(dateStr) {
        const deleted = await this.mysqlRepo.deleteCandlesForDate(dateStr);
        if (deleted > 0) {
            this.logger.log(`Cleared ${deleted} existing rows for ${dateStr}`);
        }
    }
    // ── Time & date ───────────────────────────────────────────────────────────
    todayET() {
        return new Date().toLocaleDateString('en-CA', {
            timeZone: 'America/New_York'
        });
    }
    nowET() {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).formatToParts(new Date());
        const get = (type)=>parts.find((p)=>p.type === type)?.value ?? '0';
        const hours = parseInt(get('hour'), 10);
        const minutes = parseInt(get('minute'), 10);
        return {
            hours,
            minutes,
            minuteOfDay: hours * 60 + minutes
        };
    }
    isWithinRestoreWindow() {
        const { minuteOfDay } = this.nowET();
        return minuteOfDay >= 4 * 60 && minuteOfDay < 12 * 60;
    }
    prevTradingDay(dateStr) {
        const d = new Date(dateStr + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        const dow = d.getUTCDay();
        if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
        else if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
    }
    constructor(moduleRef, mysqlRepo, alpacaDataSource, scannerService, gateway, topGainersSource, scannedTracker, fundamentalCache, autoTrader){
        this.moduleRef = moduleRef;
        this.mysqlRepo = mysqlRepo;
        this.alpacaDataSource = alpacaDataSource;
        this.scannerService = scannerService;
        this.gateway = gateway;
        this.topGainersSource = topGainersSource;
        this.scannedTracker = scannedTracker;
        this.fundamentalCache = fundamentalCache;
        this.autoTrader = autoTrader;
        this.logger = new _common.Logger(CollectorService.name);
        /** All symbols we collect candle data for */ this.symbols = new Map();
        /** Subset eligible for prediction / auto-trading (refreshed every cron cycle) */ this.activeSymbols = new Set();
        if (this.autoTrader) this.autoTrader.setGateway(this.gateway);
    }
};
CollectorService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_param(8, (0, _common.Optional)()),
    _ts_param(8, (0, _common.Inject)(_autotraderservice.AutoTraderService)),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _core.ModuleRef === "undefined" ? Object : _core.ModuleRef,
        typeof _mysqltrainingrepository.MysqlTrainingRepository === "undefined" ? Object : _mysqltrainingrepository.MysqlTrainingRepository,
        typeof _alpacadatasource.AlpacaDataSource === "undefined" ? Object : _alpacadatasource.AlpacaDataSource,
        typeof _scannerservice.ScannerService === "undefined" ? Object : _scannerservice.ScannerService,
        typeof _collectorgateway.CollectorGateway === "undefined" ? Object : _collectorgateway.CollectorGateway,
        typeof _topgainerssourceservice.TopGainersSourceService === "undefined" ? Object : _topgainerssourceservice.TopGainersSourceService,
        typeof _scannedtrackerservice.ScannedTrackerService === "undefined" ? Object : _scannedtrackerservice.ScannedTrackerService,
        typeof _fundamentalcacheservice.FundamentalCacheService === "undefined" ? Object : _fundamentalcacheservice.FundamentalCacheService,
        typeof _autotraderservice.AutoTraderService === "undefined" ? Object : _autotraderservice.AutoTraderService
    ])
], CollectorService);

//# sourceMappingURL=collector.service.js.map