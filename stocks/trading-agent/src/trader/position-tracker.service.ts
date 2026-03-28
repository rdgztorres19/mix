/**
 * PositionTrackerService: persists open auto-trade positions in MySQL
 * so they survive app restarts.  Tracks candle countdown for auto-exit.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MysqlTrainingRepository } from '../scanner/mysql/mysql-training.repository';

export interface AutoPosition {
  id: number;
  symbol: string;
  entry_time: string;
  entry_price: number;
  take_profit_price: number | null;
  stop_loss_price: number | null;
  qty: number;
  entry_candle_idx: number;
  candles_elapsed: number;
  exit_time: string | null;
  exit_price: number | null;
  pnl: number | null;
  status: 'open' | 'closed';
  alpaca_order_id: string;
  metadata: Record<string, unknown> | null;
}

@Injectable()
export class PositionTrackerService implements OnModuleInit {
  private readonly logger = new Logger(PositionTrackerService.name);
  private openPositions = new Map<string, AutoPosition>();

  constructor(private readonly mysqlRepo: MysqlTrainingRepository) {}

  async onModuleInit(): Promise<void> {
    await this.ensureTable();
    await this.loadOpenPositions();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Queries (read-only)
  // ═══════════════════════════════════════════════════════════════════════

  hasOpenPosition(symbol: string): boolean {
    return this.openPositions.has(symbol.toUpperCase());
  }

  getOpenPosition(symbol: string): AutoPosition | undefined {
    return this.openPositions.get(symbol.toUpperCase());
  }

  getAllOpen(): AutoPosition[] {
    return [...this.openPositions.values()];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Commands (mutations)
  // ═══════════════════════════════════════════════════════════════════════

  async openPosition(
    symbol: string,
    entryPrice: number,
    qty: number,
    candleIdx: number,
    alpacaOrderId: string,
    metadata: Record<string, unknown> | null = null,
    takeProfitPrice: number | null = null,
    stopLossPrice: number | null = null,
  ): Promise<AutoPosition> {
    symbol = symbol.toUpperCase();

    const id = await this.insertPositionRow(symbol, entryPrice, qty, candleIdx, alpacaOrderId, metadata, takeProfitPrice, stopLossPrice);
    const pos = this.buildNewPosition(id, symbol, entryPrice, qty, candleIdx, alpacaOrderId, metadata, takeProfitPrice, stopLossPrice);

    this.openPositions.set(symbol, pos);
    this.logger.log(`Opened position: ${symbol} qty=${qty} @ $${entryPrice.toFixed(2)}`);
    return pos;
  }

  async incrementCandles(symbol: string): Promise<number> {
    symbol = symbol.toUpperCase();
    const pos = this.openPositions.get(symbol);
    if (!pos) return 0;

    pos.candles_elapsed += 1;
    await this.updateColumn(pos.id, 'candles_elapsed', pos.candles_elapsed);
    return pos.candles_elapsed;
  }

  async closePosition(symbol: string, exitPrice: number): Promise<AutoPosition | null> {
    symbol = symbol.toUpperCase();
    const pos = this.openPositions.get(symbol);
    if (!pos) return null;

    const pnl = this.calculatePnl(pos, exitPrice);
    this.markClosed(pos, exitPrice, pnl);
    await this.persistClose(pos);

    this.openPositions.delete(symbol);
    this.logger.log(
      `Closed position: ${symbol} @ $${exitPrice.toFixed(2)} | PnL=$${pnl.toFixed(2)} after ${pos.candles_elapsed} candles`,
    );
    return pos;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Bootstrap (table + restore)
  // ═══════════════════════════════════════════════════════════════════════

  private async ensureTable(): Promise<void> {
    const pool = this.getPool();
    if (!pool) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auto_positions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(16) NOT NULL,
        entry_time DATETIME NOT NULL,
        entry_price DECIMAL(12,4) NOT NULL,
        take_profit_price DECIMAL(12,4) DEFAULT NULL,
        stop_loss_price DECIMAL(12,4) DEFAULT NULL,
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
    // Migrate existing tables: add missing columns
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auto_positions'
    `) as any;
    const existing = new Set((cols as any[]).map((r: any) => r.COLUMN_NAME));

    if (!existing.has('metadata')) {
      await pool.query(`ALTER TABLE auto_positions ADD COLUMN metadata JSON DEFAULT NULL`);
      this.logger.log('Added metadata column to auto_positions');
    }
    if (!existing.has('take_profit_price')) {
      await pool.query(`ALTER TABLE auto_positions ADD COLUMN take_profit_price DECIMAL(12,4) DEFAULT NULL AFTER entry_price`);
      this.logger.log('Added take_profit_price column to auto_positions');
    }
    if (!existing.has('stop_loss_price')) {
      await pool.query(`ALTER TABLE auto_positions ADD COLUMN stop_loss_price DECIMAL(12,4) DEFAULT NULL AFTER take_profit_price`);
      this.logger.log('Added stop_loss_price column to auto_positions');
    }
    this.logger.log('auto_positions table ready');
  }

  private async loadOpenPositions(): Promise<void> {
    const pool = this.getPool();
    if (!pool) return;

    const [rows] = await pool.query(`SELECT * FROM auto_positions WHERE status = 'open'`);
    for (const r of rows as any[]) {
      const pos = this.rowToPosition(r);
      this.openPositions.set(pos.symbol, pos);
    }

    if (this.openPositions.size) {
      this.logger.log(
        `Restored ${this.openPositions.size} open position(s): ${[...this.openPositions.keys()].join(', ')}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Persistence helpers
  // ═══════════════════════════════════════════════════════════════════════

  private async insertPositionRow(
    symbol: string, entryPrice: number, qty: number, candleIdx: number, orderId: string,
    metadata: Record<string, unknown> | null = null,
    takeProfitPrice: number | null = null,
    stopLossPrice: number | null = null,
  ): Promise<number> {
    const pool = this.getPool();
    const [result] = await pool.query(
      `INSERT INTO auto_positions
       (symbol, entry_time, entry_price, take_profit_price, stop_loss_price, qty, entry_candle_idx, candles_elapsed, status, alpaca_order_id, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'open', ?, ?)`,
      [symbol, this.nowMysql(), entryPrice, takeProfitPrice, stopLossPrice, qty, candleIdx, orderId, metadata ? JSON.stringify(metadata) : null],
    );
    return (result as any).insertId;
  }

  private async updateColumn(id: number, column: string, value: number): Promise<void> {
    const pool = this.getPool();
    await pool.query(`UPDATE auto_positions SET ${column} = ? WHERE id = ?`, [value, id]);
  }

  private async persistClose(pos: AutoPosition): Promise<void> {
    const pool = this.getPool();
    await pool.query(
      `UPDATE auto_positions SET exit_time = ?, exit_price = ?, pnl = ?, status = 'closed' WHERE id = ?`,
      [pos.exit_time, pos.exit_price, pos.pnl, pos.id],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Pure helpers (no side effects)
  // ═══════════════════════════════════════════════════════════════════════

  private getPool(): any {
    return (this.mysqlRepo as any).getPool();
  }

  private nowMysql(): string {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  private calculatePnl(pos: AutoPosition, exitPrice: number): number {
    return (exitPrice - pos.entry_price) * pos.qty;
  }

  private markClosed(pos: AutoPosition, exitPrice: number, pnl: number): void {
    pos.exit_time = this.nowMysql();
    pos.exit_price = exitPrice;
    pos.pnl = pnl;
    pos.status = 'closed';
  }

  private buildNewPosition(
    id: number, symbol: string, entryPrice: number, qty: number, candleIdx: number, orderId: string,
    metadata: Record<string, unknown> | null = null,
    takeProfitPrice: number | null = null,
    stopLossPrice: number | null = null,
  ): AutoPosition {
    return {
      id,
      symbol,
      entry_time: this.nowMysql(),
      entry_price: entryPrice,
      take_profit_price: takeProfitPrice,
      stop_loss_price: stopLossPrice,
      qty,
      entry_candle_idx: candleIdx,
      candles_elapsed: 0,
      exit_time: null,
      exit_price: null,
      pnl: null,
      status: 'open',
      alpaca_order_id: orderId,
      metadata,
    };
  }

  private rowToPosition(r: any): AutoPosition {
    let metadata: Record<string, unknown> | null = null;
    if (r.metadata) {
      metadata = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
    }
    return {
      id: r.id,
      symbol: r.symbol,
      entry_time: String(r.entry_time),
      entry_price: parseFloat(r.entry_price),
      take_profit_price: r.take_profit_price != null ? parseFloat(r.take_profit_price) : null,
      stop_loss_price: r.stop_loss_price != null ? parseFloat(r.stop_loss_price) : null,
      qty: parseFloat(r.qty),
      entry_candle_idx: r.entry_candle_idx,
      candles_elapsed: r.candles_elapsed,
      exit_time: r.exit_time ? String(r.exit_time) : null,
      exit_price: r.exit_price ? parseFloat(r.exit_price) : null,
      pnl: r.pnl ? parseFloat(r.pnl) : null,
      status: r.status,
      alpaca_order_id: r.alpaca_order_id ?? '',
      metadata,
    };
  }
}
