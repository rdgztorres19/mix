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
var MysqlTrainingRepository_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MysqlTrainingRepository = void 0;
const common_1 = require("@nestjs/common");
const mysql = __importStar(require("mysql2/promise"));
let MysqlTrainingRepository = MysqlTrainingRepository_1 = class MysqlTrainingRepository {
    constructor() {
        this.logger = new common_1.Logger(MysqlTrainingRepository_1.name);
        this.pool = null;
    }
    getPool() {
        if (this.pool)
            return this.pool;
        const host = process.env.MYSQL_HOST ?? 'localhost';
        const port = parseInt(process.env.MYSQL_PORT ?? '3306', 10);
        const user = process.env.MYSQL_USER ?? 'root';
        const password = process.env.MYSQL_PASSWORD ?? 'sbrQp10';
        const database = process.env.MYSQL_DATABASE_TRAINING ?? 'stock_training';
        try {
            this.pool = mysql.createPool({
                host,
                port,
                user,
                password,
                database,
                waitForConnections: true,
                connectionLimit: 5,
            });
            this.logger.log(`MySQL training pool ready (${database})`);
            return this.pool;
        }
        catch (e) {
            this.logger.warn(`MySQL training pool failed: ${e.message}`);
            return null;
        }
    }
    async getAvailableDates() {
        const p = this.getPool();
        if (!p)
            return [];
        try {
            const [rows] = await p.query(`SELECT DISTINCT date FROM training_1m ORDER BY date DESC LIMIT 365`);
            return rows.map((r) => String(r.date ?? ''));
        }
        catch (e) {
            this.logger.warn(`getAvailableDates failed: ${e.message}`);
            return [];
        }
    }
    async getTickerRows(ticker, resolution) {
        const p = this.getPool();
        if (!p)
            return [];
        const table = resolution === '5m' ? 'training_5m' : 'training_1m';
        try {
            const [rows] = await p.query(`SELECT * FROM ${table} WHERE symbol = ? ORDER BY candle_idx ASC`, [ticker.toUpperCase()]);
            return rows;
        }
        catch (e) {
            this.logger.warn(`getTickerRows(${ticker}) failed: ${e.message}`);
            return [];
        }
    }
    async getTopMovers(dateStr) {
        const p = this.getPool();
        if (!p)
            return [];
        try {
            const [rows] = await p.query(`SELECT t.symbol, t.change_pct_at_candle as change_pct, t.close, t.volume
         FROM training_1m t
         INNER JOIN (SELECT symbol, MAX(candle_idx) as max_idx FROM training_1m WHERE date = ? GROUP BY symbol) m
           ON t.symbol = m.symbol AND t.candle_idx = m.max_idx
         WHERE t.date = ?
         ORDER BY t.change_pct_at_candle DESC
         LIMIT 50`, [dateStr, dateStr]);
            return rows.map((r) => ({
                symbol: String(r.symbol ?? ''),
                change_pct: Number(r.change_pct ?? 0),
                close: Number(r.close ?? 0),
                volume: Number(r.volume ?? 0),
            }));
        }
        catch (e) {
            this.logger.warn(`getTopMovers(${dateStr}) failed: ${e.message}`);
            return [];
        }
    }
    async getTickerRowsForDate(ticker, dateStr, resolution) {
        const p = this.getPool();
        if (!p)
            return [];
        const table = resolution === '5m' ? 'training_5m' : 'training_1m';
        try {
            const [rows] = await p.query(`SELECT * FROM ${table} WHERE symbol = ? AND date = ? ORDER BY candle_idx ASC`, [ticker.toUpperCase(), dateStr]);
            return rows;
        }
        catch (e) {
            this.logger.warn(`getTickerRowsForDate(${ticker}, ${dateStr}) failed: ${e.message}`);
            return [];
        }
    }
};
exports.MysqlTrainingRepository = MysqlTrainingRepository;
exports.MysqlTrainingRepository = MysqlTrainingRepository = MysqlTrainingRepository_1 = __decorate([
    (0, common_1.Injectable)()
], MysqlTrainingRepository);
//# sourceMappingURL=mysql-training.repository.js.map