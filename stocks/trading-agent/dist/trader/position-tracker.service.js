/**
 * PositionTrackerService: persists open auto-trade positions in MySQL
 * so they survive app restarts.  Tracks candle countdown for auto-exit.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PositionTrackerService", {
    enumerable: true,
    get: function() {
        return PositionTrackerService;
    }
});
const _common = require("@nestjs/common");
const _mysqltrainingrepository = require("../scanner/mysql/mysql-training.repository");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let PositionTrackerService = class PositionTrackerService {
    async onModuleInit() {
        await this.ensureTable();
        await this.loadOpenPositions();
    }
    // ═══════════════════════════════════════════════════════════════════════
    // Queries (read-only)
    // ═══════════════════════════════════════════════════════════════════════
    hasOpenPosition(symbol) {
        return this.openPositions.has(symbol.toUpperCase());
    }
    getOpenPosition(symbol) {
        return this.openPositions.get(symbol.toUpperCase());
    }
    getAllOpen() {
        return [
            ...this.openPositions.values()
        ];
    }
    // ═══════════════════════════════════════════════════════════════════════
    // Commands (mutations)
    // ═══════════════════════════════════════════════════════════════════════
    async openPosition(symbol, entryPrice, qty, candleIdx, alpacaOrderId, metadata = null) {
        symbol = symbol.toUpperCase();
        const id = await this.insertPositionRow(symbol, entryPrice, qty, candleIdx, alpacaOrderId, metadata);
        const pos = this.buildNewPosition(id, symbol, entryPrice, qty, candleIdx, alpacaOrderId, metadata);
        this.openPositions.set(symbol, pos);
        this.logger.log(`Opened position: ${symbol} qty=${qty} @ $${entryPrice.toFixed(2)}`);
        return pos;
    }
    async incrementCandles(symbol) {
        symbol = symbol.toUpperCase();
        const pos = this.openPositions.get(symbol);
        if (!pos) return 0;
        pos.candles_elapsed += 1;
        await this.updateColumn(pos.id, 'candles_elapsed', pos.candles_elapsed);
        return pos.candles_elapsed;
    }
    async closePosition(symbol, exitPrice) {
        symbol = symbol.toUpperCase();
        const pos = this.openPositions.get(symbol);
        if (!pos) return null;
        const pnl = this.calculatePnl(pos, exitPrice);
        this.markClosed(pos, exitPrice, pnl);
        await this.persistClose(pos);
        this.openPositions.delete(symbol);
        this.logger.log(`Closed position: ${symbol} @ $${exitPrice.toFixed(2)} | PnL=$${pnl.toFixed(2)} after ${pos.candles_elapsed} candles`);
        return pos;
    }
    // ═══════════════════════════════════════════════════════════════════════
    // Bootstrap (table + restore)
    // ═══════════════════════════════════════════════════════════════════════
    async ensureTable() {
        const pool = this.getPool();
        if (!pool) return;
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
        metadata JSON DEFAULT NULL,
        INDEX idx_status (status),
        INDEX idx_symbol_status (symbol, status)
      )
    `);
        // Add metadata column if missing (for existing tables)
        await pool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auto_positions' AND COLUMN_NAME = 'metadata'
    `).then(async ([rows])=>{
            if (rows.length === 0) {
                await pool.query(`ALTER TABLE auto_positions ADD COLUMN metadata JSON DEFAULT NULL`);
                this.logger.log('Added metadata column to auto_positions');
            }
        });
        this.logger.log('auto_positions table ready');
    }
    async loadOpenPositions() {
        const pool = this.getPool();
        if (!pool) return;
        const [rows] = await pool.query(`SELECT * FROM auto_positions WHERE status = 'open'`);
        for (const r of rows){
            const pos = this.rowToPosition(r);
            this.openPositions.set(pos.symbol, pos);
        }
        if (this.openPositions.size) {
            this.logger.log(`Restored ${this.openPositions.size} open position(s): ${[
                ...this.openPositions.keys()
            ].join(', ')}`);
        }
    }
    // ═══════════════════════════════════════════════════════════════════════
    // Persistence helpers
    // ═══════════════════════════════════════════════════════════════════════
    async insertPositionRow(symbol, entryPrice, qty, candleIdx, orderId, metadata = null) {
        const pool = this.getPool();
        const [result] = await pool.query(`INSERT INTO auto_positions
       (symbol, entry_time, entry_price, qty, entry_candle_idx, candles_elapsed, status, alpaca_order_id, metadata)
       VALUES (?, ?, ?, ?, ?, 0, 'open', ?, ?)`, [
            symbol,
            this.nowMysql(),
            entryPrice,
            qty,
            candleIdx,
            orderId,
            metadata ? JSON.stringify(metadata) : null
        ]);
        return result.insertId;
    }
    async updateColumn(id, column, value) {
        const pool = this.getPool();
        await pool.query(`UPDATE auto_positions SET ${column} = ? WHERE id = ?`, [
            value,
            id
        ]);
    }
    async persistClose(pos) {
        const pool = this.getPool();
        await pool.query(`UPDATE auto_positions SET exit_time = ?, exit_price = ?, pnl = ?, status = 'closed' WHERE id = ?`, [
            pos.exit_time,
            pos.exit_price,
            pos.pnl,
            pos.id
        ]);
    }
    // ═══════════════════════════════════════════════════════════════════════
    // Pure helpers (no side effects)
    // ═══════════════════════════════════════════════════════════════════════
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
    buildNewPosition(id, symbol, entryPrice, qty, candleIdx, orderId, metadata = null) {
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
            metadata
        };
    }
    rowToPosition(r) {
        let metadata = null;
        if (r.metadata) {
            metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
        }
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
            metadata
        };
    }
    constructor(mysqlRepo){
        this.mysqlRepo = mysqlRepo;
        this.logger = new _common.Logger(PositionTrackerService.name);
        this.openPositions = new Map();
    }
};
PositionTrackerService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _mysqltrainingrepository.MysqlTrainingRepository === "undefined" ? Object : _mysqltrainingrepository.MysqlTrainingRepository
    ])
], PositionTrackerService);

//# sourceMappingURL=position-tracker.service.js.map