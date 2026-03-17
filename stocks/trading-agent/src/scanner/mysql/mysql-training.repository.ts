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

  /**
   * Get all distinct symbols in training_1m for a given date.
   * Used by sync-date-all to know which symbols to re-fetch from Alpaca.
   */
  async getSymbolsForDate(dateStr: string): Promise<string[]> {
    const p = this.getPool();
    if (!p) return [];
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT DISTINCT symbol FROM training_1m WHERE date = ? ORDER BY symbol`,
        [dateStr],
      );
      return rows.map((r) => String(r.symbol ?? ''));
    } catch (e) {
      this.logger.warn(`getSymbolsForDate(${dateStr}) failed: ${(e as Error).message}`);
      return [];
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

  // ─── Collector: active symbols persistence ──────────────────────────────

  async ensureCollectorTable(): Promise<void> {
    const p = this.getPool();
    if (!p) return;
    try {
      await p.query(`
        CREATE TABLE IF NOT EXISTS collector_symbols (
          symbol VARCHAR(16) NOT NULL PRIMARY KEY,
          added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          source VARCHAR(32) NOT NULL DEFAULT 'momo',
          active TINYINT NOT NULL DEFAULT 1
        )
      `);
      this.logger.log('collector_symbols table ready');
    } catch (e) {
      this.logger.warn(`ensureCollectorTable failed: ${(e as Error).message}`);
    }
  }

  async ensureTrackerTable(): Promise<void> {
    const p = this.getPool();
    if (!p) return;
    try {
      await p.query(`
        CREATE TABLE IF NOT EXISTS scanned_symbols (
           symbol VARCHAR(16) NOT NULL PRIMARY KEY,
           arrived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           passes_pre_filter TINYINT(1) DEFAULT 0,
           float_shares BIGINT,
           outstanding_shares BIGINT,
           free_float DOUBLE,
           catalyst_strength VARCHAR(32),
           catalyst_type VARCHAR(128),
           premarket_volume DOUBLE,
           premarket_dollar_volume DOUBLE,
           volume DOUBLE,
           dollar_volume DOUBLE,
           close DOUBLE,
           ema9 DOUBLE,
           gap_pct DOUBLE,
           updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      this.logger.log('scanned_symbols table ready');
    } catch (e) {
      this.logger.warn(`ensureTrackerTable failed: ${(e as Error).message}`);
    }
  }

  async upsertScannedSymbol(data: {
    symbol: string;
    passes_pre_filter: boolean;
    float_shares: number | null;
    outstanding_shares: number | null;
    free_float: number | null;
    catalyst_strength: string | null;
    catalyst_type: string | null;
    premarket_volume: number | null;
    premarket_dollar_volume: number | null;
    volume: number | null;
    dollar_volume: number | null;
    close: number | null;
    ema9: number | null;
    gap_pct: number | null;
  }): Promise<void> {
    const p = this.getPool();
    if (!p) return;

    try {
      await p.query(
        `INSERT INTO scanned_symbols (
          symbol, passes_pre_filter,
          float_shares, outstanding_shares, free_float,
          catalyst_strength, catalyst_type,
          premarket_volume, premarket_dollar_volume,
          volume, dollar_volume, close, ema9, gap_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          passes_pre_filter = VALUES(passes_pre_filter),
          float_shares = IFNULL(VALUES(float_shares), float_shares),
          outstanding_shares = IFNULL(VALUES(outstanding_shares), outstanding_shares),
          free_float = IFNULL(VALUES(free_float), free_float),
          catalyst_strength = IFNULL(VALUES(catalyst_strength), catalyst_strength),
          catalyst_type = IFNULL(VALUES(catalyst_type), catalyst_type),
          premarket_volume = VALUES(premarket_volume),
          premarket_dollar_volume = VALUES(premarket_dollar_volume),
          volume = VALUES(volume),
          dollar_volume = VALUES(dollar_volume),
          close = VALUES(close),
          ema9 = VALUES(ema9),
          gap_pct = VALUES(gap_pct)`,
        [
          data.symbol,
          data.passes_pre_filter ? 1 : 0,
          data.float_shares, data.outstanding_shares, data.free_float,
          data.catalyst_strength, data.catalyst_type,
          data.premarket_volume, data.premarket_dollar_volume,
          data.volume, data.dollar_volume,
          data.close, data.ema9, data.gap_pct
        ],
      );
    } catch (e) {
      this.logger.warn(`upsertScannedSymbol(${data.symbol}) failed: ${(e as Error).message}`);
    }
  }

  async getScannedSymbolsForToday(): Promise<Record<string, unknown>[]> {
    const p = this.getPool();
    if (!p) return [];
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT * FROM scanned_symbols WHERE DATE(arrived_at) = CURDATE() ORDER BY arrived_at DESC`
      );
      return rows as unknown as Record<string, unknown>[];
    } catch (e) {
      this.logger.warn(`getScannedSymbolsForToday failed: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * Check if symbol exists in scanned_symbols for today and passes prefilter:
   * close > 2, float_shares 1M–100M, premarket_dollar_volume <= threshold.
   * Used by AutoTraderService before noon to gate trade entry.
   */
  async passesPrefilterForToday(symbol: string): Promise<boolean> {
    const p = this.getPool();
    if (!p) return false;
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT close, float_shares, premarket_dollar_volume
         FROM scanned_symbols
         WHERE symbol = ? AND DATE(arrived_at) = CURDATE()`,
        [symbol.toUpperCase()],
      );
      if (!rows || !Array.isArray(rows) || rows.length === 0) return false;
      const r = rows[0];
      const close = Number(r?.close ?? 0);
      const floatShares = Number(r?.float_shares ?? 0);
      const premarketDollarVol = Number(r?.premarket_dollar_volume ?? Infinity);
      return (
        close > 2 &&
        floatShares >= 1_000_000 &&
        floatShares <= 100_000_000 &&
        premarketDollarVol <= 10_007_568.983475
      );
    } catch (e) {
      this.logger.warn(`passesPrefilterForToday(${symbol}) failed: ${(e as Error).message}`);
      return false;
    }
  }

  async saveActiveSymbol(symbol: string, source: string): Promise<void> {
    const p = this.getPool();
    if (!p) return;
    try {
      await p.query(
        `REPLACE INTO collector_symbols (symbol, source, active) VALUES (?, ?, 1)`,
        [symbol.toUpperCase(), source],
      );
    } catch (e) {
      this.logger.warn(`saveActiveSymbol(${symbol}) failed: ${(e as Error).message}`);
    }
  }

  /**
   * Get symbols to restore at startup: all from today (CURDATE) OR added in last 24h.
   * Uses both criteria to handle timezone differences (ET vs UTC) and ensure we get "all from today".
   */
  async getActiveSymbols(): Promise<{ symbol: string; source: string; added_at: string }[]> {
    const p = this.getPool();
    if (!p) return [];
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT symbol, source, added_at FROM collector_symbols
         WHERE DATE(added_at) = CURDATE() OR added_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         ORDER BY added_at DESC`,
      );
      const seen = new Set<string>();
      const result: { symbol: string; source: string; added_at: string }[] = [];
      for (const r of rows) {
        const sym = String(r.symbol);
        if (seen.has(sym)) continue;
        seen.add(sym);
        result.push({ symbol: sym, source: String(r.source), added_at: String(r.added_at) });
      }
      return result;
    } catch (e) {
      this.logger.warn(`getActiveSymbols failed: ${(e as Error).message}`);
      return [];
    }
  }

  async deactivateAllSymbols(): Promise<void> {
    const p = this.getPool();
    if (!p) return;
    try {
      await p.query(`UPDATE collector_symbols SET active = 0`);
    } catch (e) {
      this.logger.warn(`deactivateAllSymbols failed: ${(e as Error).message}`);
    }
  }

  // ─── Collector: candle CRUD ─────────────────────────────────────────────

  async getLastCandleForSymbol(
    symbol: string,
    dateStr: string,
  ): Promise<{ candle_idx: number; candle_time_et: string } | null> {
    const p = this.getPool();
    if (!p) return null;
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT candle_idx, candle_time_et FROM training_1m
         WHERE symbol = ? AND date = ?
         ORDER BY candle_idx DESC LIMIT 1`,
        [symbol.toUpperCase(), dateStr],
      );
      if (!rows.length) return null;
      return {
        candle_idx: Number(rows[0].candle_idx),
        candle_time_et: String(rows[0].candle_time_et),
      };
    } catch (e) {
      this.logger.warn(`getLastCandleForSymbol(${symbol}) failed: ${(e as Error).message}`);
      return null;
    }
  }

  async getRecentCandles(
    symbol: string,
    dateStr: string,
    limit = 30,
  ): Promise<Record<string, unknown>[]> {
    const p = this.getPool();
    if (!p) return [];
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT * FROM training_1m
         WHERE symbol = ? AND date = ?
         ORDER BY candle_idx DESC LIMIT ?`,
        [symbol.toUpperCase(), dateStr, limit],
      );
      return (rows as unknown as Record<string, unknown>[]).reverse();
    } catch (e) {
      this.logger.warn(`getRecentCandles(${symbol}) failed: ${(e as Error).message}`);
      return [];
    }
  }

  async upsertCandle(row: Record<string, unknown>): Promise<void> {
    const p = this.getPool();
    if (!p) return;

    const cols = [
      'symbol', 'date', 'candle_idx', 'candle_time_et',
      'open', 'high', 'low', 'close', 'volume',
      'atr', 'vwap', 'ema9', 'ema20',
      'high_of_day', 'low_of_day',
      'change_pct_at_candle', 'pre_market_high', 'session',
      'shares_outstanding', 'market_cap', 'gap_pct', 'premarket_volume',
      'momentum_acumulado',
      'change_1m', 'change_5m', 'change_10m', 'minutes_since_hod',
      'future_return_5m', 'target', 'target_break_hod_5m', 'max_future_return_10m',
    ];
    const placeholders = cols.map(() => '?').join(',');
    const values = cols.map((c) => row[c] ?? null);

    try {
      await p.query(
        `REPLACE INTO training_1m (${cols.join(',')}) VALUES (${placeholders})`,
        values,
      );
    } catch (e) {
      this.logger.warn(`upsertCandle failed: ${(e as Error).message}`);
    }
  }

  /**
   * Bulk-insert rows using multi-row REPLACE (much faster than one-by-one).
   * Splits into chunks of 500 to avoid exceeding MySQL packet limits.
   */
  async bulkUpsertCandles(rows: Record<string, unknown>[]): Promise<void> {
    const p = this.getPool();
    if (!p || !rows.length) return;

    const cols = [
      'symbol', 'date', 'candle_idx', 'candle_time_et',
      'open', 'high', 'low', 'close', 'volume',
      'atr', 'vwap', 'ema9', 'ema20',
      'high_of_day', 'low_of_day',
      'change_pct_at_candle', 'pre_market_high', 'session',
      'shares_outstanding', 'market_cap', 'gap_pct', 'premarket_volume',
      'momentum_acumulado',
      'change_1m', 'change_5m', 'change_10m', 'minutes_since_hod',
      'future_return_5m', 'target', 'target_break_hod_5m', 'max_future_return_10m',
    ];

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const placeholderRow = `(${cols.map(() => '?').join(',')})`;
      const placeholders = chunk.map(() => placeholderRow).join(',');
      const values = chunk.flatMap((row) => cols.map((c) => row[c] ?? null));
      try {
        await p.query(
          `REPLACE INTO training_1m (${cols.join(',')}) VALUES ${placeholders}`,
          values,
        );
      } catch (e) {
        this.logger.warn(`bulkUpsertCandles chunk failed: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Delete ALL candles for a given date (all symbols).
   * Used before sync-today to clear stale data from previous sources.
   */
  async deleteCandlesForDate(dateStr: string): Promise<number> {
    const p = this.getPool();
    if (!p) return 0;
    try {
      const [result] = await p.query('DELETE FROM training_1m WHERE date = ?', [dateStr]);
      const deleted = (result as { affectedRows?: number }).affectedRows ?? 0;
      if (deleted > 0) {
        this.logger.log(`Deleted ${deleted} rows for date ${dateStr}`);
      }
      return deleted;
    } catch (e) {
      this.logger.warn(`deleteCandlesForDate(${dateStr}) failed: ${(e as Error).message}`);
      return 0;
    }
  }

  /**
   * Delete all candles for a symbol on a given date.
   * Used before backfill to ensure clean data.
   */
  async deleteCandlesForSymbolDate(symbol: string, date: string): Promise<number> {
    const p = this.getPool();
    if (!p) return 0;
    try {
      const [result] = await p.query(
        'DELETE FROM training_1m WHERE symbol = ? AND date = ?',
        [symbol, date],
      );
      return (result as any).affectedRows ?? 0;
    } catch (e) {
      this.logger.warn(`deleteCandlesForSymbolDate failed: ${(e as Error).message}`);
      return 0;
    }
  }
}
