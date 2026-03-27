import { Injectable, Logger } from '@nestjs/common';
import * as mysql from 'mysql2/promise';

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type ScreenerRankType =
  | 'gapper'
  | 'gainer_intraday'
  | 'gainer_session'
  | 'high_session'
  | 'high_current';

export interface ScreenerAssetRow {
  symbol: string;
  asset_id: string;
  class: string;
  exchange: string;
  name: string;
  status: string;
  tradable: boolean;
  marginable: boolean;
  shortable: boolean;
  easy_to_borrow: boolean;
  fractionable: boolean;
  maintenance_margin_requirement: string | null;
  margin_requirement_long: string | null;
  margin_requirement_short: string | null;
}

export interface ScreenerRankRow {
  rank_type: ScreenerRankType;
  rank_order: number;
  symbol: string;
  metric_value: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  previous_close?: number;
  volume?: number;
}

@Injectable()
export class ScreenerRepository {
  private readonly logger = new Logger(ScreenerRepository.name);
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
      this.logger.log(`Screener MySQL pool ready (${database})`);
      return this.pool;
    } catch (e) {
      this.logger.warn(`Screener MySQL pool failed: ${(e as Error).message}`);
      return null;
    }
  }

  private dbBatchSize(): number {
    return toPositiveInt(process.env.SCREENER_DB_BATCH_SIZE, 500);
  }

  async ensureTables(): Promise<void> {
    const p = this.getPool();
    if (!p) return;
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
      try {
        const [cols] = await p.query<mysql.RowDataPacket[]>(
          "SHOW COLUMNS FROM screener_active_symbols LIKE 'session_date'",
        );
        if (!cols.length) {
          await p.query(`ALTER TABLE screener_active_symbols ADD COLUMN session_date DATE NULL AFTER score`);
          await p.query(`UPDATE screener_active_symbols SET session_date = UTC_DATE() WHERE session_date IS NULL`);
          await p.query(
            `CREATE INDEX idx_screener_active_symbols_session_date ON screener_active_symbols (session_date)`,
          );
        }
      } catch (e) {
        this.logger.warn(`screener_active_symbols migration failed: ${(e as Error).message}`);
      }
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
    } catch (e) {
      this.logger.warn(`ensureTables failed: ${(e as Error).message}`);
    }
  }

  async countAssets(): Promise<number> {
    const p = this.getPool();
    if (!p) return 0;
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS c FROM screener_assets');
      return Number(rows[0]?.c ?? 0);
    } catch {
      return 0;
    }
  }

  async bulkInsertAssets(assets: ScreenerAssetRow[]): Promise<void> {
    const p = this.getPool();
    if (!p || !assets.length) return;
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
        const params: unknown[] = [];

        for (const a of batch) {
          params.push(
            a.symbol.toUpperCase(),
            a.asset_id,
            a.class,
            a.exchange,
            a.name.slice(0, 500),
            a.status,
            a.tradable ? 1 : 0,
            a.marginable ? 1 : 0,
            a.shortable ? 1 : 0,
            a.easy_to_borrow ? 1 : 0,
            a.fractionable ? 1 : 0,
            a.maintenance_margin_requirement,
            a.margin_requirement_long,
            a.margin_requirement_short,
          );
        }

        await conn.query(sqlPrefix + placeholders, params);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async getUniverseSymbols(filters: {
    onlyActive: boolean;
    onlyTradable: boolean;
    excludeOtc: boolean;
  }): Promise<string[]> {
    const p = this.getPool();
    if (!p) return [];
    let sql = 'SELECT symbol FROM screener_assets WHERE class = ?';
    const params: unknown[] = ['us_equity'];
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
      const [rows] = await p.query<mysql.RowDataPacket[]>(sql, params);
      return rows.map((r) => String(r.symbol ?? '').toUpperCase()).filter(Boolean);
    } catch {
      return [];
    }
  }

  async getPrevCloseMapForDate(asOfDate: string): Promise<Map<string, number>> {
    const p = this.getPool();
    const m = new Map<string, number>();
    if (!p) return m;
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        'SELECT symbol, prev_close FROM screener_prev_close WHERE as_of_date = ?',
        [asOfDate],
      );
      for (const r of rows) {
        const sym = String(r.symbol ?? '').toUpperCase();
        const v = Number(r.prev_close);
        if (sym && Number.isFinite(v)) m.set(sym, v);
      }
    } catch {
      /* empty */
    }
    return m;
  }

  async getPrevClose(symbol: string, asOfDate: string): Promise<number | null> {
    const p = this.getPool();
    if (!p) return null;
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        'SELECT prev_close FROM screener_prev_close WHERE symbol = ? AND as_of_date = ?',
        [symbol.toUpperCase(), asOfDate],
      );
      if (!rows.length) return null;
      const v = Number(rows[0].prev_close);
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }

  async upsertPrevClose(symbol: string, asOfDate: string, prevClose: number, source: string): Promise<void> {
    await this.upsertPrevClosesBatch(asOfDate, source, [{ symbol, prevClose }]);
  }

  async upsertPrevClosesBatch(
    asOfDate: string,
    source: string,
    entries: { symbol: string; prevClose: number }[],
  ): Promise<void> {
    const p = this.getPool();
    if (!p || !entries.length) return;
    const batchSize = this.dbBatchSize();

    const conn = await p.getConnection();
    try {
      const sqlPrefix = `
        REPLACE INTO screener_prev_close (symbol, as_of_date, prev_close, source) VALUES `;
      const rowPlaceholder = '(?, ?, ?, ?)';

      await conn.beginTransaction();
      for (const batch of chunkArray(entries, batchSize)) {
        const placeholders = batch.map(() => rowPlaceholder).join(', ');
        const params: unknown[] = [];
        for (const e of batch) {
          params.push(e.symbol.toUpperCase(), asOfDate, e.prevClose, source);
        }
        await conn.query(sqlPrefix + placeholders, params);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async upsertQuoteSnapshot(
    symbol: string,
    lastPrice: number | null,
    dayHigh: number | null,
    dayLow: number | null,
    dayClose: number | null,
    volume: number | null,
  ): Promise<void> {
    await this.upsertQuoteSnapshotsBatch([
      { symbol, lastPrice, dayHigh, dayLow, dayClose, volume },
    ]);
  }

  async upsertQuoteSnapshotsBatch(
    entries: {
      symbol: string;
      lastPrice: number | null;
      dayHigh: number | null;
      dayLow: number | null;
      dayClose: number | null;
      volume: number | null;
    }[],
  ): Promise<void> {
    const p = this.getPool();
    if (!p || !entries.length) return;
    const batchSize = this.dbBatchSize();

    const conn = await p.getConnection();
    try {
      const sqlPrefix = `
        REPLACE INTO screener_quote_snapshot (symbol, last_price, day_high, day_low, day_close, volume) VALUES `;
      const rowPlaceholder = '(?, ?, ?, ?, ?, ?)';

      await conn.beginTransaction();
      for (const batch of chunkArray(entries, batchSize)) {
        const placeholders = batch.map(() => rowPlaceholder).join(', ');
        const params: unknown[] = [];
        for (const e of batch) {
          params.push(
            e.symbol.toUpperCase(),
            e.lastPrice,
            e.dayHigh,
            e.dayLow,
            e.dayClose,
            e.volume,
          );
        }
        await conn.query(sqlPrefix + placeholders, params);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async replaceRankRows(rankType: ScreenerRankType, rows: ScreenerRankRow[]): Promise<void> {
    const p = this.getPool();
    if (!p) return;
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
        const params: unknown[] = [];
        for (const r of batch) {
          params.push(
            r.rank_type,
            r.rank_order,
            r.symbol.toUpperCase(),
            r.metric_value,
            r.open ?? null,
            r.high ?? null,
            r.low ?? null,
            r.close ?? null,
            r.previous_close ?? null,
            r.volume ?? null,
          );
        }
        await conn.query(sqlPrefix + placeholders, params);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async getRankRows(rankType: ScreenerRankType): Promise<ScreenerRankRow[]> {
    const p = this.getPool();
    if (!p) return [];
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        `SELECT rank_type, rank_order, symbol, metric_value, open_px, high_px, low_px, close_px, previous_close, volume
         FROM screener_rank_rows WHERE rank_type = ? ORDER BY rank_order ASC`,
        [rankType],
      );
      return rows.map((r) => ({
        rank_type: r.rank_type as ScreenerRankType,
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
    } catch {
      return [];
    }
  }

  async replaceActiveSymbols(
    entries: { rank_order: number; symbol: string; score: number }[],
    sessionDate: string,
  ): Promise<void> {
    const p = this.getPool();
    if (!p) return;
    const conn = await p.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM screener_active_symbols');
      const batchSize = this.dbBatchSize();
      const sqlPrefix = 'INSERT INTO screener_active_symbols (rank_order, symbol, score, session_date) VALUES ';
      const rowPlaceholder = '(?, ?, ?, ?)';

      for (const batch of chunkArray(entries, batchSize)) {
        const placeholders = batch.map(() => rowPlaceholder).join(', ');
        const params: unknown[] = [];
        for (const e of batch) {
          params.push(e.rank_order, e.symbol.toUpperCase(), e.score, sessionDate);
        }
        await conn.query(sqlPrefix + placeholders, params);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async getActiveSymbols(sessionDate: string): Promise<{ symbol: string; score: number; rank_order: number }[]> {
    const p = this.getPool();
    if (!p) return [];
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>(
        'SELECT rank_order, symbol, score FROM screener_active_symbols WHERE session_date = ? ORDER BY rank_order ASC',
        [sessionDate],
      );
      return rows.map((r) => ({
        rank_order: Number(r.rank_order),
        symbol: String(r.symbol),
        score: Number(r.score),
      }));
    } catch {
      return [];
    }
  }

  async updateRunMeta(sessionDate: string | null, symbolsScanned: number, note?: string): Promise<void> {
    const p = this.getPool();
    if (!p) return;
    await p.query(
      `UPDATE screener_run_meta SET last_run_utc = UTC_TIMESTAMP(), last_session_date = ?, symbols_scanned = ?, note = ? WHERE id = 1`,
      [sessionDate, symbolsScanned, note ?? null],
    );
  }

  async getRunMeta(): Promise<{
    last_run_utc: Date | null;
    last_session_date: string | null;
    symbols_scanned: number | null;
    note: string | null;
  } | null> {
    const p = this.getPool();
    if (!p) return null;
    try {
      const [rows] = await p.query<mysql.RowDataPacket[]>('SELECT * FROM screener_run_meta WHERE id = 1');
      if (!rows.length) return null;
      const r = rows[0];
      return {
        last_run_utc: r.last_run_utc ? new Date(r.last_run_utc) : null,
        last_session_date: r.last_session_date ? String(r.last_session_date).slice(0, 10) : null,
        symbols_scanned: r.symbols_scanned != null ? Number(r.symbols_scanned) : null,
        note: r.note != null ? String(r.note) : null,
      };
    } catch {
      return null;
    }
  }
}
