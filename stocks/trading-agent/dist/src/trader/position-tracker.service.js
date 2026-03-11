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
var PositionTrackerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PositionTrackerService = void 0;
const common_1 = require("@nestjs/common");
const mysql_training_repository_1 = require("../scanner/mysql/mysql-training.repository");
let PositionTrackerService = PositionTrackerService_1 = class PositionTrackerService {
    constructor(mysqlRepo) {
        this.mysqlRepo = mysqlRepo;
        this.logger = new common_1.Logger(PositionTrackerService_1.name);
        this.openPositions = new Map();
    }
    async onModuleInit() {
        await this.ensureTable();
        await this.loadOpenPositions();
    }
    hasOpenPosition(symbol) {
        return this.openPositions.has(symbol.toUpperCase());
    }
    getOpenPosition(symbol) {
        return this.openPositions.get(symbol.toUpperCase());
    }
    getAllOpen() {
        return [...this.openPositions.values()];
    }
    async openPosition(symbol, entryPrice, qty, candleIdx, alpacaOrderId) {
        symbol = symbol.toUpperCase();
        const id = await this.insertPositionRow(symbol, entryPrice, qty, candleIdx, alpacaOrderId);
        const pos = this.buildNewPosition(id, symbol, entryPrice, qty, candleIdx, alpacaOrderId);
        this.openPositions.set(symbol, pos);
        this.logger.log(`Opened position: ${symbol} qty=${qty} @ $${entryPrice.toFixed(2)}`);
        return pos;
    }
    async incrementCandles(symbol) {
        symbol = symbol.toUpperCase();
        const pos = this.openPositions.get(symbol);
        if (!pos)
            return 0;
        pos.candles_elapsed += 1;
        await this.updateColumn(pos.id, 'candles_elapsed', pos.candles_elapsed);
        return pos.candles_elapsed;
    }
    async closePosition(symbol, exitPrice) {
        symbol = symbol.toUpperCase();
        const pos = this.openPositions.get(symbol);
        if (!pos)
            return null;
        const pnl = this.calculatePnl(pos, exitPrice);
        this.markClosed(pos, exitPrice, pnl);
        await this.persistClose(pos);
        this.openPositions.delete(symbol);
        this.logger.log(`Closed position: ${symbol} @ $${exitPrice.toFixed(2)} | PnL=$${pnl.toFixed(2)} after ${pos.candles_elapsed} candles`);
        return pos;
    }
    async ensureTable() {
        const pool = this.getPool();
        if (!pool)
            return;
        await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_positions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(16) NOT NULL,
        entry_time DATETIME NOT NULL,
        entry_price DECIMAL(12,4) NOT NULL,
        qty DECIMAL(16,8) NOT NULL,
        entry_candle_idx INT NOT NULL DEFAULT 0,
        candles_elapsed INT NOT NULL DEFAULT 0,
        exit_time DATETIME DEFAULT NULL,
        exit_price DECIMAL(12,4) DEFAULT NULL,
        pnl DECIMAL(12,4) DEFAULT NULL,
        status ENUM('open','closed') NOT NULL DEFAULT 'open',
        alpaca_order_id VARCHAR(64) NOT NULL DEFAULT '',
        INDEX idx_status (status),
        INDEX idx_symbol_status (symbol, status)
      )
    `);
        this.logger.log('auto_positions table ready');
    }
    async loadOpenPositions() {
        const pool = this.getPool();
        if (!pool)
            return;
        const [rows] = await pool.query(`SELECT * FROM auto_positions WHERE status = 'open'`);
        for (const r of rows) {
            const pos = this.rowToPosition(r);
            this.openPositions.set(pos.symbol, pos);
        }
        if (this.openPositions.size) {
            this.logger.log(`Restored ${this.openPositions.size} open position(s): ${[...this.openPositions.keys()].join(', ')}`);
        }
    }
    async insertPositionRow(symbol, entryPrice, qty, candleIdx, orderId) {
        const pool = this.getPool();
        const [result] = await pool.query(`INSERT INTO auto_positions
       (symbol, entry_time, entry_price, qty, entry_candle_idx, candles_elapsed, status, alpaca_order_id)
       VALUES (?, ?, ?, ?, ?, 0, 'open', ?)`, [symbol, this.nowMysql(), entryPrice, qty, candleIdx, orderId]);
        return result.insertId;
    }
    async updateColumn(id, column, value) {
        const pool = this.getPool();
        await pool.query(`UPDATE auto_positions SET ${column} = ? WHERE id = ?`, [value, id]);
    }
    async persistClose(pos) {
        const pool = this.getPool();
        await pool.query(`UPDATE auto_positions SET exit_time = ?, exit_price = ?, pnl = ?, status = 'closed' WHERE id = ?`, [pos.exit_time, pos.exit_price, pos.pnl, pos.id]);
    }
    getPool() {
        return this.mysqlRepo.getPool();
    }
    nowMysql() {
        return new Date().toISOString().slice(0, 19).replace('T', ' ');
    }
    calculatePnl(pos, exitPrice) {
        return (exitPrice - pos.entry_price) * pos.qty;
    }
    markClosed(pos, exitPrice, pnl) {
        pos.exit_time = this.nowMysql();
        pos.exit_price = exitPrice;
        pos.pnl = pnl;
        pos.status = 'closed';
    }
    buildNewPosition(id, symbol, entryPrice, qty, candleIdx, orderId) {
        return {
            id,
            symbol,
            entry_time: this.nowMysql(),
            entry_price: entryPrice,
            qty,
            entry_candle_idx: candleIdx,
            candles_elapsed: 0,
            exit_time: null,
            exit_price: null,
            pnl: null,
            status: 'open',
            alpaca_order_id: orderId,
        };
    }
    rowToPosition(r) {
        return {
            id: r.id,
            symbol: r.symbol,
            entry_time: String(r.entry_time),
            entry_price: parseFloat(r.entry_price),
            qty: parseFloat(r.qty),
            entry_candle_idx: r.entry_candle_idx,
            candles_elapsed: r.candles_elapsed,
            exit_time: r.exit_time ? String(r.exit_time) : null,
            exit_price: r.exit_price ? parseFloat(r.exit_price) : null,
            pnl: r.pnl ? parseFloat(r.pnl) : null,
            status: r.status,
            alpaca_order_id: r.alpaca_order_id ?? '',
        };
    }
};
exports.PositionTrackerService = PositionTrackerService;
exports.PositionTrackerService = PositionTrackerService = PositionTrackerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [mysql_training_repository_1.MysqlTrainingRepository])
], PositionTrackerService);
//# sourceMappingURL=position-tracker.service.js.map