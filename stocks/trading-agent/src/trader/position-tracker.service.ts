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
  qty: number;
  entry_candle_idx: number;
  candles_elapsed: number;
  exit_time: string | null;
  exit_price: number | null;
  pnl: number | null;
  status: 'open' | 'closed';
  alpaca_order_id: string;
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
  ): Promise<AutoPosition> {
    symbol = symbol.toUpperCase();

    const id = await this.insertPositionRow(symbol, entryPrice, qty, candleIdx, alpacaOrderId);
    const pos = this.buildNewPosition(id, symbol, entryPrice, qty, candleIdx, alpacaOrderId);

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
  ): Promise<number> {
    const pool = this.getPool();
    const [result] = await pool.query(
      `INSERT INTO auto_positions
       (symbol, entry_time, entry_price, qty, entry_candle_idx, candles_elapsed, status, alpaca_order_id)
       VALUES (?, ?, ?, ?, ?, 0, 'open', ?)`,
      [symbol, this.nowMysql(), entryPrice, qty, candleIdx, orderId],
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
  ): AutoPosition {
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

  private rowToPosition(r: any): AutoPosition {
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
}
