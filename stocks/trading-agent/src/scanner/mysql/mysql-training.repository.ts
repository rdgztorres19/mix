import { Injectable, Logger } from '@nestjs/common';
import * as mysql from 'mysql2/promise';

/**
 * Repository (ORM-style) for stock_training MySQL DB.
 * Data populated by stock-training: npm run sync-mysql
 */
@Injectable()
export class MysqlTrainingRepository {
  private readonly logger = new Logger(MysqlTrainingRepository.name);
  private pool: mysql.Pool | null = null;

  private getPool(): mysql.Pool | null {
    if (this.pool) return this.pool;
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
    } catch (e) {
      this.logger.warn(`MySQL training pool failed: ${(e as Error).message}`);
      return null;
    }
  }

  async getAvailableDates(): Promise<string[]> {
    const p = this.getPool();
    if (!p) return [];
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT DISTINCT date FROM training_1m ORDER BY date DESC LIMIT 365`,
      );
      return rows.map((r) => String(r.date ?? ''));
    } catch (e) {
      this.logger.warn(`getAvailableDates failed: ${(e as Error).message}`);
      return [];
    }
  }

  async getTickerRows(ticker: string, resolution: '1m' | '5m'): Promise<Record<string, unknown>[]> {
    const p = this.getPool();
    if (!p) return [];
    const table = resolution === '5m' ? 'training_5m' : 'training_1m';
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT * FROM ${table} WHERE symbol = ? ORDER BY candle_idx ASC`,
        [ticker.toUpperCase()],
      );
      return rows as unknown as Record<string, unknown>[];
    } catch (e) {
      this.logger.warn(`getTickerRows(${ticker}) failed: ${(e as Error).message}`);
      return [];
    }
  }

  async getTopMovers(dateStr: string): Promise<{ symbol: string; change_pct: number; close: number; volume: number }[]> {
    const p = this.getPool();
    if (!p) return [];
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT t.symbol, t.change_pct_at_candle as change_pct, t.close, t.volume
         FROM training_1m t
         INNER JOIN (SELECT symbol, MAX(candle_idx) as max_idx FROM training_1m WHERE date = ? GROUP BY symbol) m
           ON t.symbol = m.symbol AND t.candle_idx = m.max_idx
         WHERE t.date = ?
         ORDER BY t.change_pct_at_candle DESC
         LIMIT 50`,
        [dateStr, dateStr],
      );
      return rows.map((r) => ({
        symbol: String(r.symbol ?? ''),
        change_pct: Number(r.change_pct ?? 0),
        close: Number(r.close ?? 0),
        volume: Number(r.volume ?? 0),
      }));
    } catch (e) {
      this.logger.warn(`getTopMovers(${dateStr}) failed: ${(e as Error).message}`);
      return [];
    }
  }

  async getTickerRowsForDate(
    ticker: string,
    dateStr: string,
    resolution: '1m' | '5m',
  ): Promise<Record<string, unknown>[]> {
    const p = this.getPool();
    if (!p) return [];
    const table = resolution === '5m' ? 'training_5m' : 'training_1m';
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT * FROM ${table} WHERE symbol = ? AND date = ? ORDER BY candle_idx ASC`,
        [ticker.toUpperCase(), dateStr],
      );
      return rows as unknown as Record<string, unknown>[];
    } catch (e) {
      this.logger.warn(`getTickerRowsForDate(${ticker}, ${dateStr}) failed: ${(e as Error).message}`);
      return [];
    }
  }
}
