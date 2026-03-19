"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ScannedTrackerService", {
    enumerable: true,
    get: function() {
        return ScannedTrackerService;
    }
});
const _common = require("@nestjs/common");
const _mysqltrainingrepository = require("../../scanner/mysql/mysql-training.repository");
const _axios = /*#__PURE__*/ _interop_require_default(require("axios"));
const _newstool = require("../../agent/tools/news.tool");
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
let ScannedTrackerService = class ScannedTrackerService {
    async onModuleInit() {
        await this.mysqlRepo.ensureTrackerTable();
        await this.loadTodayTrackedSymbolsFromDb();
    }
    async loadTodayTrackedSymbolsFromDb() {
        try {
            const rows = await this.mysqlRepo.getScannedSymbolsForToday();
            for (const row of rows){
                this.trackedSymbols.set(row.symbol, {
                    symbol: row.symbol,
                    passes_pre_filter: row.passes_pre_filter === 1,
                    float_shares: row.float_shares,
                    outstanding_shares: row.outstanding_shares,
                    free_float: row.free_float,
                    catalyst_strength: row.catalyst_strength,
                    catalyst_type: row.catalyst_type,
                    premarket_volume: row.premarket_volume,
                    premarket_dollar_volume: row.premarket_dollar_volume,
                    volume: row.volume,
                    dollar_volume: row.dollar_volume,
                    close: row.close,
                    ema9: row.ema9,
                    gap_pct: row.gap_pct,
                    arrived_at: new Date(row.arrived_at),
                    updated_at: new Date(row.updated_at)
                });
            }
            this.logger.log(`Loaded ${this.trackedSymbols.size} tracked symbols from DB for today.`);
        } catch (err) {
            this.logger.error(`Failed to load tracked symbols on init: ${err.message}`);
        }
    }
    getTrackedSymbols() {
        // Return array sorted by arrived_at desc
        return Array.from(this.trackedSymbols.values()).sort((a, b)=>b.arrived_at.getTime() - a.arrived_at.getTime());
    }
    /**
   * Invoked when the scanner identifies a new symbol
   */ async trackNewSymbol(symbol) {
        if (this.trackedSymbols.has(symbol)) {
            return; // Already tracking today
        }
        const now = new Date();
        const newData = {
            symbol,
            passes_pre_filter: false,
            float_shares: null,
            outstanding_shares: null,
            free_float: null,
            catalyst_strength: null,
            catalyst_type: null,
            premarket_volume: null,
            premarket_dollar_volume: null,
            volume: null,
            dollar_volume: null,
            close: null,
            ema9: null,
            gap_pct: null,
            arrived_at: now,
            updated_at: now
        };
        this.trackedSymbols.set(symbol, newData);
        // Attempt to fetch float immediately since it only needs to happen once
        await this.fetchFloatData(newData);
        // Attempt to fetch news catalyst immediately
        await this.fetchNewsData(newData);
        // Save initial state to DB
        await this.mysqlRepo.upsertScannedSymbol(newData);
        this.logger.log(`Started tracking new symbol from scanner: ${symbol}`);
    }
    async fetchFloatData(data) {
        const fmpKey = process.env.FMP_API_KEY;
        if (!fmpKey) {
            this.logger.warn(`No FMP_API_KEY found, skipping float fetch for ${data.symbol}`);
            return;
        }
        try {
            const url = `https://financialmodelingprep.com/stable/shares-float?symbol=${data.symbol}&apikey=${fmpKey}`;
            const res = await _axios.default.get(url, {
                timeout: 8000
            });
            if (res.data && Array.isArray(res.data) && res.data.length > 0) {
                const info = res.data[0];
                data.float_shares = info.floatShares || null;
                data.outstanding_shares = info.outstandingShares || null;
                data.free_float = info.freeFloat || null;
                this.logger.log(`Fetched float for ${data.symbol}: ${data.free_float}% free float`);
            }
        } catch (err) {
            this.logger.error(`Failed to fetch float for ${data.symbol}: ${err.message}`);
        }
    }
    async fetchNewsData(data) {
        try {
            let headlines = await (0, _newstool.fetchYahooNews)(data.symbol);
            if (!headlines.length) {
                headlines = await (0, _newstool.fetchFinvizNews)(data.symbol);
            }
            const { strength, catalyst_type } = await (0, _newstool.scoreHeadlines)(headlines);
            data.catalyst_strength = strength;
            data.catalyst_type = catalyst_type;
            this.logger.log(`Fetched news catalyst for ${data.symbol}: ${strength} - ${catalyst_type}`);
        } catch (err) {
            this.logger.error(`Failed to fetch news for ${data.symbol}: ${err.message}`);
        }
    }
    /**
   * Updates tracking calculations (premarket/volume/ema9 etc)
   * This is called by the Cron job every 1 min
   */ async updateCalculatedMetrics(symbol, metrics) {
        const tracked = this.trackedSymbols.get(symbol);
        if (!tracked) return;
        tracked.premarket_volume = metrics.premarket_volume;
        tracked.premarket_dollar_volume = metrics.premarket_dollar_volume;
        tracked.volume = metrics.volume;
        tracked.dollar_volume = metrics.dollar_volume;
        tracked.close = metrics.close;
        tracked.ema9 = metrics.ema9;
        tracked.gap_pct = metrics.gap_pct;
        tracked.passes_pre_filter = metrics.passes_pre_filter;
        tracked.updated_at = new Date();
        // Persist to DB
        await this.mysqlRepo.upsertScannedSymbol(tracked);
    }
    constructor(mysqlRepo){
        this.mysqlRepo = mysqlRepo;
        this.logger = new _common.Logger(ScannedTrackerService.name);
        // In-memory cache for today's tracked symbols
        this.trackedSymbols = new Map();
    }
};
ScannedTrackerService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _mysqltrainingrepository.MysqlTrainingRepository === "undefined" ? Object : _mysqltrainingrepository.MysqlTrainingRepository
    ])
], ScannedTrackerService);

//# sourceMappingURL=scanned-tracker.service.js.map