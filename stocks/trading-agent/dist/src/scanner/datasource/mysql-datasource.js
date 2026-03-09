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
var MysqlDataSource_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MysqlDataSource = void 0;
const common_1 = require("@nestjs/common");
const mysql_training_repository_1 = require("../mysql/mysql-training.repository");
const small_cap_trading_1 = require("../../small-cap-trading");
let MysqlDataSource = MysqlDataSource_1 = class MysqlDataSource {
    constructor(mysqlRepo) {
        this.mysqlRepo = mysqlRepo;
        this.logger = new common_1.Logger(MysqlDataSource_1.name);
    }
    async getStockSnapshot(ticker, options) {
        const dateStr = options?.date;
        if (!dateStr) {
            this.logger.warn('MysqlDataSource requires date for historical data');
            return this.emptySnapshot(ticker);
        }
        const rows = await this.mysqlRepo.getTickerRowsForDate(ticker, dateStr, '1m');
        if (!rows.length) {
            this.logger.warn(`No MySQL data for ${ticker} on ${dateStr}`);
            return this.emptySnapshot(ticker);
        }
        const candles1m = this.rowsToCandles(rows, dateStr);
        if (!candles1m.length)
            return this.emptySnapshot(ticker);
        let filtered = candles1m;
        if (options?.cutoffMs) {
            filtered = candles1m.filter((c) => c.t <= options.cutoffMs);
            if (!filtered.length)
                return this.emptySnapshot(ticker);
        }
        const candles5m = this.aggregate1mTo5m(filtered);
        const timeframe = options?.timeframe ?? '5m';
        const candlesForMetrics = timeframe === '1m' ? filtered : candles5m;
        const latest = candlesForMetrics[candlesForMetrics.length - 1];
        const price = latest.c;
        const high_of_day = Math.max(...filtered.map((c) => c.h));
        const low_of_day = Math.min(...filtered.map((c) => c.l));
        const volume = filtered.reduce((s, c) => s + c.v, 0);
        const avg_volume = this.estimateAvgFromRows(rows);
        const relative_volume = avg_volume > 0 ? volume / avg_volume : 0;
        const lastRow = rows[rows.length - 1];
        const vwap = lastRow?.vwap != null ? Number(lastRow.vwap) : small_cap_trading_1.VwapCalculator.calculate(candlesForMetrics);
        const vwap_line = small_cap_trading_1.VwapCalculator.calculateLine(candlesForMetrics);
        const closes = candlesForMetrics.map((c) => c.c);
        const ema9 = lastRow?.ema9 != null ? Number(lastRow.ema9) : null;
        const ema20 = lastRow?.ema20 != null ? Number(lastRow.ema20) : null;
        const atr = lastRow?.atr != null ? Number(lastRow.atr) : 0.5;
        const pre_market_high = lastRow?.pre_market_high != null ? Number(lastRow.pre_market_high) : null;
        const change_pct = lastRow?.change_pct_at_candle != null ? Number(lastRow.change_pct_at_candle) : 0;
        return {
            ticker: ticker.toUpperCase(),
            price,
            vwap: vwap > 0 ? vwap : null,
            vwap_line,
            ema9: ema9 != null && ema9 > 0 ? ema9 : null,
            ema20: ema20 != null && ema20 > 0 ? ema20 : null,
            volume,
            avg_volume,
            relative_volume,
            change_pct,
            pre_market_high,
            candles_1min: filtered,
            candles_5min: candles5m,
            atr,
            high_of_day,
            low_of_day,
        };
    }
    rowsToCandles(rows, dateStr) {
        const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
        const candles = [];
        for (const r of rows) {
            const timeEt = String(r.candle_time_et ?? '00:00');
            const [h, m] = timeEt.split(':').map((x) => parseInt(String(x), 10) || 0);
            const [, mo, d] = String(dateStr).split('-').map(Number);
            const isEDT = (mo > 3 && mo < 11) || (mo === 3 && d >= 8) || (mo === 11 && d < 7);
            const offset = isEDT ? '-04:00' : '-05:00';
            const ts = new Date(`${dateStr}T${pad(h)}:${pad(m)}:00${offset}`).getTime();
            candles.push({
                o: Number(r.open ?? 0),
                h: Number(r.high ?? 0),
                l: Number(r.low ?? 0),
                c: Number(r.close ?? 0),
                v: Number(r.volume ?? 0),
                t: ts,
            });
        }
        return candles;
    }
    aggregate1mTo5m(candles) {
        const groups = {};
        for (const c of candles) {
            const bucket = Math.floor(c.t / (5 * 60 * 1000)) * (5 * 60 * 1000);
            if (!groups[bucket])
                groups[bucket] = [];
            groups[bucket].push(c);
        }
        return Object.keys(groups)
            .map(Number)
            .sort((a, b) => a - b)
            .map((bucket) => {
            const g = groups[bucket];
            return {
                o: g[0].o,
                h: Math.max(...g.map((x) => x.h)),
                l: Math.min(...g.map((x) => x.l)),
                c: g[g.length - 1].c,
                v: g.reduce((s, x) => s + x.v, 0),
                t: bucket,
            };
        });
    }
    estimateAvgFromRows(rows) {
        const volRel = rows.map((r) => Number(r.volume_rel ?? r.volume ?? 0));
        if (!volRel.length)
            return 1;
        const lastVol = Number(rows[rows.length - 1]?.volume ?? 0);
        const lastRel = Number(rows[rows.length - 1]?.volume_rel ?? 0);
        if (lastRel > 0 && lastVol > 0)
            return lastVol / lastRel;
        return lastVol || 1;
    }
    async getAvailableDates() {
        return this.mysqlRepo.getAvailableDates();
    }
    emptySnapshot(ticker) {
        return {
            ticker: ticker.toUpperCase(),
            price: 0,
            vwap: null,
            vwap_line: [],
            ema9: null,
            ema20: null,
            volume: 0,
            avg_volume: 1,
            relative_volume: 0,
            change_pct: 0,
            pre_market_high: null,
            candles_1min: [],
            candles_5min: [],
            atr: 0.5,
            high_of_day: 0,
            low_of_day: 0,
        };
    }
};
exports.MysqlDataSource = MysqlDataSource;
exports.MysqlDataSource = MysqlDataSource = MysqlDataSource_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [mysql_training_repository_1.MysqlTrainingRepository])
], MysqlDataSource);
//# sourceMappingURL=mysql-datasource.js.map