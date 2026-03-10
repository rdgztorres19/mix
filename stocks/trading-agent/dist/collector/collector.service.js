/**
 * CollectorService: main orchestrator for the real-time data collection pipeline.
 *
 * Responsibilities:
 * 1. Manage active symbols (persist in MySQL, keep in memory)
 * 2. Backfill missing 1m candles from MoMo API on late start / restart
 * 3. Process closed 1m candles (compute indicators, upsert MySQL, push WS)
 * 4. Wire Alpaca subscriptions through AlpacaStreamService
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
const _axios = /*#__PURE__*/ _interop_require_default(require("axios"));
const _mysqltrainingrepository = require("../scanner/mysql/mysql-training.repository");
const _scannerservice = require("../scanner/scanner.service");
const _momostreamservice = require("./momo-stream.service");
const _collectorgateway = require("./collector.gateway");
const _autotraderservice = require("../trader/auto-trader.service");
const _indicatorcalculator = require("./indicator.calculator");
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
let CollectorService = class CollectorService {
    async onModuleInit() {
        this.logger.log('CollectorService initializing…');
        // 1. Ensure persistence table exists
        await this.mysqlRepo.ensureCollectorTable();
        // 2. Wire MoMo stream → candle closed callback + live tick callback
        this.momoStream.init((symbol, candle)=>this.onCandleClosed(symbol, candle), (symbol, candle)=>this.onLiveTick(symbol, candle));
        // 3. Load persisted symbols from previous session (parallel in batches of 5)
        const persisted = await this.mysqlRepo.getActiveSymbols();
        if (persisted.length) {
            this.logger.log(`Restoring ${persisted.length} persisted symbols: ${persisted.map((s)=>s.symbol).join(', ')}`);
            const BATCH = 5;
            for(let i = 0; i < persisted.length; i += BATCH){
                const batch = persisted.slice(i, i + BATCH);
                await Promise.all(batch.map(({ symbol })=>this.addSymbol(symbol, 'restored', true)));
            }
        }
        this.logger.log(`CollectorService ready — ${this.activeSymbols.size} active symbols`);
    }
    /**
   * Add a new symbol to track. Fetches metadata, backfills today's candles,
   * subscribes to Alpaca real-time trades.
   */ async addSymbol(symbol, source = 'momo', skipPersist = false) {
        symbol = symbol.toUpperCase();
        if (this.activeSymbols.has(symbol)) return;
        this.logger.log(`Adding symbol: ${symbol} (source: ${source})`);
        // Fetch metadata from momo snapshot
        let metadata = {
            priorClose: 0,
            preMarketHigh: 0,
            sharesOutstanding: 0,
            marketCap: 0,
            gapPct: 0,
            premarketVolume: 0
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
                premarketVolume: 0
            };
        } catch (err) {
            this.logger.warn(`Failed to fetch metadata for ${symbol}: ${err.message}`);
        }
        const state = {
            symbol,
            metadata,
            history: []
        };
        this.activeSymbols.set(symbol, state);
        // Persist symbol
        if (!skipPersist) {
            await this.mysqlRepo.saveActiveSymbol(symbol, source);
        }
        // Backfill today's candles
        await this.backfillFromMomo(symbol);
        // Subscribe to MoMo real-time live quotes
        this.momoStream.subscribe([
            symbol
        ]);
        // Notify UI clients
        this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
    }
    /**
   * Backfill today's 1m candles from MoMo API.
   * Deletes existing data for symbol+date and reinserts cleanly.
   */ async backfillFromMomo(symbol) {
        if (this.isAfterHoursNow()) {
            this.logger.log(`Backfill skipped (after hours): ${symbol}`);
            return;
        }
        const state = this.activeSymbols.get(symbol);
        if (!state) return;
        const todayET = this.getTodayDateET();
        this.logger.log(`Backfilling ${symbol} for ${todayET}`);
        // Fetch 1m candles from MoMo
        let allCandles = [];
        try {
            const url = `${this.momoBase}/ticker/chart?q=${symbol}&interval=1m`;
            const res = await _axios.default.get(url, {
                timeout: 10000
            });
            if (res.data?.error !== 0 || !res.data?.message?.history) {
                this.logger.warn(`MoMo returned no data for ${symbol}`);
                return;
            }
            const raw = res.data.message.history;
            allCandles = raw.slice().reverse().map(([o, h, l, c, v, t])=>({
                    o,
                    h,
                    l,
                    c,
                    v,
                    t
                }));
        } catch (err) {
            this.logger.warn(`MoMo fetch failed for ${symbol}: ${err.message}`);
            return;
        }
        // Filter to today only
        const todayCandles = allCandles.filter((c)=>{
            const { date } = (0, _indicatorcalculator.timestampToET)(c.t);
            return date === todayET;
        });
        if (!todayCandles.length) {
            this.logger.log(`No candles for ${symbol} today`);
            return;
        }
        // Build history from today's candles
        state.history = todayCandles.map((c)=>({
                o: c.o,
                h: c.h,
                l: c.l,
                c: c.c,
                v: c.v,
                t: c.t
            }));
        // Delete all existing data for this symbol+date, then bulk-insert fresh
        const deleted = await this.mysqlRepo.deleteCandlesForSymbolDate(symbol, todayET);
        if (deleted > 0) {
            this.logger.log(`Deleted ${deleted} old rows for ${symbol} on ${todayET}`);
        }
        const allRows = [];
        for(let i = 0; i < state.history.length; i++){
            const historySlice = state.history.slice(0, i + 1);
            allRows.push((0, _indicatorcalculator.computeCandleRow)(symbol, historySlice, state.metadata));
        }
        await this.mysqlRepo.bulkUpsertCandles(allRows);
        this.logger.log(`Backfilled ${symbol}: ${todayCandles.length} candles inserted clean`);
    }
    /**
   * Called by CandleBuilder on every trade tick with the current in-progress candle.
   * Pushes live (partial) candle to UI so the user sees it moving.
   */ onLiveTick(symbol, candle) {
        const state = this.activeSymbols.get(symbol);
        if (!state) return;
        this.gateway.emitCandleLive(symbol, candle);
    }
    /**
   * Called by CandleBuilder when a 1-minute candle closes from Alpaca real-time trades.
   */ async onCandleClosed(symbol, candle) {
        const state = this.activeSymbols.get(symbol);
        if (!state) return;
        // Deduplicate: if the last candle in history has the same minute, replace it
        const last = state.history[state.history.length - 1];
        if (last && last.t === candle.t) {
            state.history[state.history.length - 1] = candle;
        } else {
            state.history.push(candle);
        }
        // Compute indicators and build MySQL row
        const row = (0, _indicatorcalculator.computeCandleRow)(symbol, state.history, state.metadata);
        // Upsert into MySQL
        await this.mysqlRepo.upsertCandle(row);
        // Push to UI via WebSocket
        this.gateway.emitCandleUpdate(row);
        // Auto-predict + auto-trade (fire-and-forget, don't block candle pipeline)
        if (this.autoTrader) {
            this.autoTrader.onCandleClosed(row).catch((err)=>this.logger.warn(`AutoTrader error: ${err.message}`));
        }
        this.logger.debug(`${symbol} ${row.candle_time_et} | c=${row.close.toFixed(3)} v=${row.volume} ` + `vwap=${row.vwap.toFixed(3)} ema9=${row.ema9.toFixed(3)} atr=${row.atr.toFixed(3)}`);
    }
    /**
   * Clear active symbols for a fresh trading day.
   */ async resetActiveSymbols() {
        const symbols = [
            ...this.activeSymbols.keys()
        ];
        if (symbols.length) {
            this.momoStream.unsubscribe(symbols);
        }
        this.activeSymbols.clear();
        await this.mysqlRepo.deactivateAllSymbols();
        this.gateway.emitSymbolsUpdate([]);
        this.logger.log('Active symbols cleared for new day');
    }
    /**
   * Scan MoMo for hot tickers and add any new ones.
   */ async scanMomo() {
        this.logger.log('Scanning MoMo for hot tickers…');
        const url = `https://momoscreener.com/api/momo?int=5&change=3`;
        let items = [];
        try {
            const res = await _axios.default.get(url, {
                timeout: 10000
            });
            items = res.data?.message ?? [];
        } catch (err) {
            this.logger.warn(`MoMo scan failed: ${err.message}`);
            return [];
        }
        // Deduplicate by symbol
        const seen = new Set();
        const newSymbols = [];
        for (const item of items){
            const sym = (item.symbol || '').toUpperCase();
            if (!sym || seen.has(sym)) continue;
            seen.add(sym);
            // Apply basic filters
            const price = item.live?.lastPrice ?? item.stats?.price ?? 0;
            const change = item.change ?? 0;
            if (price < 2 || price > 20) continue;
            if (change < 3) continue;
            if (!this.activeSymbols.has(sym)) {
                newSymbols.push(sym);
            }
        }
        // Add new symbols
        for (const sym of newSymbols){
            await this.addSymbol(sym, 'momo_scan');
            // Small delay between API calls
            await new Promise((r)=>setTimeout(r, 500));
        }
        if (newSymbols.length) {
            this.logger.log(`MoMo scan added ${newSymbols.length} new symbols: ${newSymbols.join(', ')}`);
        } else {
            this.logger.log(`MoMo scan: no new symbols (${this.activeSymbols.size} active)`);
        }
        return newSymbols;
    }
    /**
   * Periodic refresh: fetch latest candles from MoMo for all active symbols
   * and upsert only candles newer than what we already have.
   * This fills gaps left by Alpaca IEX's limited coverage.
   */ async refreshAllFromMomo(options = {}) {
        if (!options.force && this.isAfterHoursNow()) {
            this.logger.log('MoMo refresh skipped (after hours)');
            return {
                skipped: true,
                reason: 'after_hours'
            };
        }
        const symbols = [
            ...this.activeSymbols.keys()
        ];
        if (!symbols.length) return {
            skipped: true,
            reason: 'no_active_symbols'
        };
        this.logger.log(`MoMo refresh: updating ${symbols.length} symbols…`);
        const todayET = this.getTodayDateET();
        for (const symbol of symbols){
            const state = this.activeSymbols.get(symbol);
            if (!state) continue;
            try {
                const url = `${this.momoBase}/ticker/chart?q=${symbol}&interval=1m`;
                const res = await _axios.default.get(url, {
                    timeout: 10000
                });
                if (res.data?.error !== 0 || !res.data?.message?.history) continue;
                const raw = res.data.message.history;
                const allCandles = raw.slice().reverse().map(([o, h, l, c, v, t])=>({
                        o,
                        h,
                        l,
                        c,
                        v,
                        t
                    }));
                const todayCandles = allCandles.filter((c)=>{
                    const { date, minuteOfDay } = (0, _indicatorcalculator.timestampToET)(c.t);
                    return date === todayET && minuteOfDay >= 570 && minuteOfDay < 960;
                });
                if (!todayCandles.length) continue;
                // Replace history with MoMo's more complete data
                state.history = todayCandles.map((c)=>({
                        o: c.o,
                        h: c.h,
                        l: c.l,
                        c: c.c,
                        v: c.v,
                        t: c.t
                    }));
                // Upsert all candles (ON DUPLICATE KEY UPDATE handles existing ones)
                let newCount = 0;
                for(let i = 0; i < state.history.length; i++){
                    const historySlice = state.history.slice(0, i + 1);
                    const row = (0, _indicatorcalculator.computeCandleRow)(symbol, historySlice, state.metadata);
                    await this.mysqlRepo.upsertCandle(row);
                    newCount++;
                }
                this.logger.debug(`MoMo refresh ${symbol}: ${newCount} candles upserted`);
            } catch (err) {
                this.logger.warn(`MoMo refresh failed for ${symbol}: ${err.message}`);
            }
            // Small delay between symbols to avoid hammering MoMo
            await new Promise((r)=>setTimeout(r, 500));
        }
        this.logger.log(`MoMo refresh complete for ${symbols.length} symbols`);
        return {
            skipped: false
        };
    }
    /**
   * Get list of actively tracked symbols.
   */ getActiveSymbolList() {
        return [
            ...this.activeSymbols.keys()
        ];
    }
    /**
   * Get today's date string in ET timezone.
   */ getTodayDateET() {
        return new Date().toLocaleDateString('en-CA', {
            timeZone: 'America/New_York'
        });
    }
    getMinuteOfDayET() {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).formatToParts(new Date());
        const get = (type)=>parts.find((p)=>p.type === type)?.value ?? '0';
        const h = parseInt(get('hour'), 10);
        const m = parseInt(get('minute'), 10);
        return h * 60 + m;
    }
    isAfterHoursNow() {
        return this.getMinuteOfDayET() >= 16 * 60;
    }
    constructor(mysqlRepo, scannerService, momoStream, gateway, autoTrader){
        this.mysqlRepo = mysqlRepo;
        this.scannerService = scannerService;
        this.momoStream = momoStream;
        this.gateway = gateway;
        this.autoTrader = autoTrader;
        this.logger = new _common.Logger(CollectorService.name);
        this.activeSymbols = new Map();
        this.momoBase = process.env.MOMO_BASE_URL ?? 'https://momoscreener.com/api/p';
        // Inject gateway into autoTrader (avoids circular module dependency)
        if (this.autoTrader) this.autoTrader.setGateway(this.gateway);
    }
};
CollectorService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_param(4, (0, _common.Optional)()),
    _ts_param(4, (0, _common.Inject)(_autotraderservice.AutoTraderService)),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _mysqltrainingrepository.MysqlTrainingRepository === "undefined" ? Object : _mysqltrainingrepository.MysqlTrainingRepository,
        typeof _scannerservice.ScannerService === "undefined" ? Object : _scannerservice.ScannerService,
        typeof _momostreamservice.MomoStreamService === "undefined" ? Object : _momostreamservice.MomoStreamService,
        typeof _collectorgateway.CollectorGateway === "undefined" ? Object : _collectorgateway.CollectorGateway,
        typeof _autotraderservice.AutoTraderService === "undefined" ? Object : _autotraderservice.AutoTraderService
    ])
], CollectorService);

//# sourceMappingURL=collector.service.js.map