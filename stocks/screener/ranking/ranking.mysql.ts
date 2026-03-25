import mysql from 'mysql2/promise';
import { Gapper, Gainer, RankingResult } from './types';

export class RankingMySQL {
  private pool: mysql.Pool;

  constructor(config: mysql.PoolOptions) {
    this.pool = mysql.createPool(config);
  }

  async saveRanking(result: RankingResult) {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM screener_gappers');
      await conn.query('DELETE FROM screener_gainers');
      await conn.query('DELETE FROM screener_combined');
      for (const g of result.gappers) {
        await conn.query('INSERT INTO screener_gappers (symbol, open, previous_close, gap_pct, volume, rank) VALUES (?, ?, ?, ?, ?, ?)', [g.symbol, g.open, g.previousClose, g.gapPct, g.volume, g.rank]);
      }
      for (const g of result.gainers) {
        await conn.query('INSERT INTO screener_gainers (symbol, close, previous_close, pct_change, volume, rank) VALUES (?, ?, ?, ?, ?, ?)', [g.symbol, g.close, g.previousClose, g.pctChange, g.volume, g.rank]);
      }
      for (const s of result.combined) {
        await conn.query('INSERT INTO screener_combined (symbol) VALUES (?)', [s]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async getGappers(): Promise<Gapper[]> {
    const [rows] = await this.pool.query('SELECT * FROM screener_gappers ORDER BY rank ASC');
    return rows as Gapper[];
  }

  async getGainers(): Promise<Gainer[]> {
    const [rows] = await this.pool.query('SELECT * FROM screener_gainers ORDER BY rank ASC');
    return rows as Gainer[];
  }

  async getCombined(): Promise<string[]> {
    const [rows] = await this.pool.query('SELECT symbol FROM screener_combined');
    return (rows as any[]).map(r => r.symbol);
  }
}
