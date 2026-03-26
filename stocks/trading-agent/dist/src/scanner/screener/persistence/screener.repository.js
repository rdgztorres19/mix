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
var ScreenerRepository_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreenerRepository = void 0;
const common_1 = require("@nestjs/common");
const mysql = __importStar(require("mysql2/promise"));
function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function chunkArray(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size)
        out.push(items.slice(i, i + size));
    return out;
}
let ScreenerRepository = ScreenerRepository_1 = class ScreenerRepository {
    constructor() {
        this.logger = new common_1.Logger(ScreenerRepository_1.name);
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
            this.logger.log(`Screener MySQL pool ready (${database})`);
            return this.pool;
        }
        catch (e) {
            this.logger.warn(`Screener MySQL pool failed: ${e.message}`);
            return null;
        }
    }
    dbBatchSize() {
        return toPositiveInt(process.env.SCREENER_DB_BATCH_SIZE, 500);
    }
    async ensureTables() {
        const p = this.getPool();
        if (!p)
            return;
        try {
            await p.query(`
        CREATE TABLE IF NOT EXISTS screener_assets (
          symbol VARCHAR(32) NOT NULL PRIMARY KEY,
          asset_id VARCHAR(64) NOT NULL,
          class VARCHAR(32) NOT NULL DEFAULT 'us_equity',
          exchange VARCHAR(16) NOT NULL DEFAULT '',
          name VARCHAR(512) NOT NULL DEFAULT '',
          status VARCHAR(32) NOT NULL DEFAULT 'active',
          tradable TINYINT(1) NOT NULL DEFAULT 0,
          marginable TINYINT(1) NOT NULL DEFAULT 0,
          shortable TINYINT(1) NOT NULL DEFAULT 0,
          easy_to_borrow TINYINT(1) NOT NULL DEFAULT 0,
          fractionable TINYINT(1) NOT NULL DEFAULT 0,
          maintenance_margin_requirement VARCHAR(64) NULL,
          margin_requirement_long VARCHAR(64) NULL,
          margin_requirement_short VARCHAR(64) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
            await p.query(`
        CREATE TABLE IF NOT EXISTS screener_prev_close (
          symbol VARCHAR(32) NOT NULL,
          as_of_date DATE NOT NULL,
          prev_close DECIMAL(20,6) NOT NULL,
          source VARCHAR(32) NOT NULL DEFAULT 'alpaca',
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (symbol, as_of_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
            await p.query(`
        CREATE TABLE IF NOT EXISTS screener_quote_snapshot (
          symbol VARCHAR(32) NOT NULL PRIMARY KEY,
          last_price DECIMAL(20,6) NULL,
          day_high DECIMAL(20,6) NULL,
          day_low DECIMAL(20,6) NULL,
          day_close DECIMAL(20,6) NULL,
          volume BIGINT NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
            await p.query(`
        CREATE TABLE IF NOT EXISTS screener_rank_rows (
          rank_type VARCHAR(32) NOT NULL,
          rank_order INT NOT NULL,
          symbol VARCHAR(32) NOT NULL,
          metric_value DECIMAL(20,10) NOT NULL,
          open_px DECIMAL(20,6) NULL,
          high_px DECIMAL(20,6) NULL,
          low_px DECIMAL(20,6) NULL,
          close_px DECIMAL(20,6) NULL,
          previous_close DECIMAL(20,6) NULL,
          volume BIGINT NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (rank_type, rank_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
            await p.query(`
        CREATE TABLE IF NOT EXISTS screener_active_symbols (
          rank_order INT NOT NULL PRIMARY KEY,
          symbol VARCHAR(32) NOT NULL,
          score DECIMAL(20,10) NOT NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
            await p.query(`
        CREATE TABLE IF NOT EXISTS screener_run_meta (
          id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
          last_run_utc DATETIME NULL,
          last_session_date DATE NULL,
          symbols_scanned INT NULL,
          note VARCHAR(255) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
            await p.query(`
        INSERT IGNORE INTO screener_run_meta (id) VALUES (1)
      `);
            this.logger.log('screener_* tables ready');
        }
        catch (e) {
            this.logger.warn(`ensureTables failed: ${e.message}`);
        }
    }
    async countAssets() {
        const p = this.getPool();
        if (!p)
            return 0;
        try {
            const [rows] = await p.query('SELECT COUNT(*) AS c FROM screener_assets');
            return Number(rows[0]?.c ?? 0);
        }
        catch {
            return 0;
        }
    }
    async bulkInsertAssets(assets) {
        const p = this.getPool();
        if (!p || !assets.length)
            return;
        const batchSize = this.dbBatchSize();
        const conn = await p.getConnection();
        try {
            const sqlPrefix = `
        REPLACE INTO screener_assets (
          symbol, asset_id, class, exchange, name, status, tradable, marginable,
          shortable, easy_to_borrow, fractionable,
          maintenance_margin_requirement, margin_requirement_long, margin_requirement_short
        ) VALUES `;
            const rowPlaceholder = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
            await conn.beginTransaction();
            for (const batch of chunkArray(assets, batchSize)) {
                const placeholders = batch.map(() => rowPlaceholder).join(', ');
                const params = [];
                for (const a of batch) {
                    params.push(a.symbol.toUpperCase(), a.asset_id, a.class, a.exchange, a.name.slice(0, 500), a.status, a.tradable ? 1 : 0, a.marginable ? 1 : 0, a.shortable ? 1 : 0, a.easy_to_borrow ? 1 : 0, a.fractionable ? 1 : 0, a.maintenance_margin_requirement, a.margin_requirement_long, a.margin_requirement_short);
                }
                await conn.query(sqlPrefix + placeholders, params);
            }
            await conn.commit();
        }
        catch (e) {
            await conn.rollback();
            throw e;
        }
        finally {
            conn.release();
        }
    }
    async getUniverseSymbols(filters) {
        const p = this.getPool();
        if (!p)
            return [];
        let sql = 'SELECT symbol FROM screener_assets WHERE class = ?';
        const params = ['us_equity'];
        if (filters.onlyActive) {
            sql += ' AND status = ?';
            params.push('active');
        }
        if (filters.onlyTradable) {
            sql += ' AND tradable = 1';
        }
        if (filters.excludeOtc) {
            sql += " AND exchange != 'OTC'";
        }
        sql += ' ORDER BY symbol ASC';
        try {
            const [rows] = await p.query(sql, params);
            return rows.map((r) => String(r.symbol ?? '').toUpperCase()).filter(Boolean);
        }
        catch {
            return [];
        }
    }
    async getPrevCloseMapForDate(asOfDate) {
        const p = this.getPool();
        const m = new Map();
        if (!p)
            return m;
        try {
            const [rows] = await p.query('SELECT symbol, prev_close FROM screener_prev_close WHERE as_of_date = ?', [asOfDate]);
            for (const r of rows) {
                const sym = String(r.symbol ?? '').toUpperCase();
                const v = Number(r.prev_close);
                if (sym && Number.isFinite(v))
                    m.set(sym, v);
            }
        }
        catch {
        }
        return m;
    }
    async getPrevClose(symbol, asOfDate) {
        const p = this.getPool();
        if (!p)
            return null;
        try {
            const [rows] = await p.query('SELECT prev_close FROM screener_prev_close WHERE symbol = ? AND as_of_date = ?', [symbol.toUpperCase(), asOfDate]);
            if (!rows.length)
                return null;
            const v = Number(rows[0].prev_close);
            return Number.isFinite(v) ? v : null;
        }
        catch {
            return null;
        }
    }
    async upsertPrevClose(symbol, asOfDate, prevClose, source) {
        await this.upsertPrevClosesBatch(asOfDate, source, [{ symbol, prevClose }]);
    }
    async upsertPrevClosesBatch(asOfDate, source, entries) {
        const p = this.getPool();
        if (!p || !entries.length)
            return;
        const batchSize = this.dbBatchSize();
        const conn = await p.getConnection();
        try {
            const sqlPrefix = `
        REPLACE INTO screener_prev_close (symbol, as_of_date, prev_close, source) VALUES `;
            const rowPlaceholder = '(?, ?, ?, ?)';
            await conn.beginTransaction();
            for (const batch of chunkArray(entries, batchSize)) {
                const placeholders = batch.map(() => rowPlaceholder).join(', ');
                const params = [];
                for (const e of batch) {
                    params.push(e.symbol.toUpperCase(), asOfDate, e.prevClose, source);
                }
                await conn.query(sqlPrefix + placeholders, params);
            }
            await conn.commit();
        }
        catch (e) {
            await conn.rollback();
            throw e;
        }
        finally {
            conn.release();
        }
    }
    async upsertQuoteSnapshot(symbol, lastPrice, dayHigh, dayLow, dayClose, volume) {
        await this.upsertQuoteSnapshotsBatch([
            { symbol, lastPrice, dayHigh, dayLow, dayClose, volume },
        ]);
    }
    async upsertQuoteSnapshotsBatch(entries) {
        const p = this.getPool();
        if (!p || !entries.length)
            return;
        const batchSize = this.dbBatchSize();
        const conn = await p.getConnection();
        try {
            const sqlPrefix = `
        REPLACE INTO screener_quote_snapshot (symbol, last_price, day_high, day_low, day_close, volume) VALUES `;
            const rowPlaceholder = '(?, ?, ?, ?, ?, ?)';
            await conn.beginTransaction();
            for (const batch of chunkArray(entries, batchSize)) {
                const placeholders = batch.map(() => rowPlaceholder).join(', ');
                const params = [];
                for (const e of batch) {
                    params.push(e.symbol.toUpperCase(), e.lastPrice, e.dayHigh, e.dayLow, e.dayClose, e.volume);
                }
                await conn.query(sqlPrefix + placeholders, params);
            }
            await conn.commit();
        }
        catch (e) {
            await conn.rollback();
            throw e;
        }
        finally {
            conn.release();
        }
    }
    async replaceRankRows(rankType, rows) {
        const p = this.getPool();
        if (!p)
            return;
        const conn = await p.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('DELETE FROM screener_rank_rows WHERE rank_type = ?', [rankType]);
            const batchSize = this.dbBatchSize();
            const sqlPrefix = `
        INSERT INTO screener_rank_rows (
          rank_type, rank_order, symbol, metric_value, open_px, high_px, low_px, close_px, previous_close, volume
        ) VALUES `;
            const rowPlaceholder = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
            for (const batch of chunkArray(rows, batchSize)) {
                const placeholders = batch.map(() => rowPlaceholder).join(', ');
                const params = [];
                for (const r of batch) {
                    params.push(r.rank_type, r.rank_order, r.symbol.toUpperCase(), r.metric_value, r.open ?? null, r.high ?? null, r.low ?? null, r.close ?? null, r.previous_close ?? null, r.volume ?? null);
                }
                await conn.query(sqlPrefix + placeholders, params);
            }
            await conn.commit();
        }
        catch (e) {
            await conn.rollback();
            throw e;
        }
        finally {
            conn.release();
        }
    }
    async getRankRows(rankType) {
        const p = this.getPool();
        if (!p)
            return [];
        try {
            const [rows] = await p.query(`SELECT rank_type, rank_order, symbol, metric_value, open_px, high_px, low_px, close_px, previous_close, volume
         FROM screener_rank_rows WHERE rank_type = ? ORDER BY rank_order ASC`, [rankType]);
            return rows.map((r) => ({
                rank_type: r.rank_type,
                rank_order: Number(r.rank_order),
                symbol: String(r.symbol),
                metric_value: Number(r.metric_value),
                open: r.open_px != null ? Number(r.open_px) : undefined,
                high: r.high_px != null ? Number(r.high_px) : undefined,
                low: r.low_px != null ? Number(r.low_px) : undefined,
                close: r.close_px != null ? Number(r.close_px) : undefined,
                previous_close: r.previous_close != null ? Number(r.previous_close) : undefined,
                volume: r.volume != null ? Number(r.volume) : undefined,
            }));
        }
        catch {
            return [];
        }
    }
    async replaceActiveSymbols(entries) {
        const p = this.getPool();
        if (!p)
            return;
        const conn = await p.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('DELETE FROM screener_active_symbols');
            const batchSize = this.dbBatchSize();
            const sqlPrefix = 'INSERT INTO screener_active_symbols (rank_order, symbol, score) VALUES ';
            const rowPlaceholder = '(?, ?, ?)';
            for (const batch of chunkArray(entries, batchSize)) {
                const placeholders = batch.map(() => rowPlaceholder).join(', ');
                const params = [];
                for (const e of batch) {
                    params.push(e.rank_order, e.symbol.toUpperCase(), e.score);
                }
                await conn.query(sqlPrefix + placeholders, params);
            }
            await conn.commit();
        }
        catch (e) {
            await conn.rollback();
            throw e;
        }
        finally {
            conn.release();
        }
    }
    async getActiveSymbols() {
        const p = this.getPool();
        if (!p)
            return [];
        try {
            const [rows] = await p.query('SELECT rank_order, symbol, score FROM screener_active_symbols ORDER BY rank_order ASC');
            return rows.map((r) => ({
                rank_order: Number(r.rank_order),
                symbol: String(r.symbol),
                score: Number(r.score),
            }));
        }
        catch {
            return [];
        }
    }
    async updateRunMeta(sessionDate, symbolsScanned, note) {
        const p = this.getPool();
        if (!p)
            return;
        await p.query(`UPDATE screener_run_meta SET last_run_utc = UTC_TIMESTAMP(), last_session_date = ?, symbols_scanned = ?, note = ? WHERE id = 1`, [sessionDate, symbolsScanned, note ?? null]);
    }
    async getRunMeta() {
        const p = this.getPool();
        if (!p)
            return null;
        try {
            const [rows] = await p.query('SELECT * FROM screener_run_meta WHERE id = 1');
            if (!rows.length)
                return null;
            const r = rows[0];
            return {
                last_run_utc: r.last_run_utc ? new Date(r.last_run_utc) : null,
                last_session_date: r.last_session_date ? String(r.last_session_date).slice(0, 10) : null,
                symbols_scanned: r.symbols_scanned != null ? Number(r.symbols_scanned) : null,
                note: r.note != null ? String(r.note) : null,
            };
        }
        catch {
            return null;
        }
    }
};
exports.ScreenerRepository = ScreenerRepository;
exports.ScreenerRepository = ScreenerRepository = ScreenerRepository_1 = __decorate([
    (0, common_1.Injectable)()
], ScreenerRepository);
//# sourceMappingURL=screener.repository.js.map