import mysql from 'mysql2/promise';
import { AlpacaAsset } from './alpaca-assets';

export class AssetsMySQL {
  private pool: mysql.Pool;

  constructor(pool: mysql.Pool) {
    this.pool = pool;
  }

  async ensureTable() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS screener_assets (
      symbol VARCHAR(16) NOT NULL PRIMARY KEY,
      name VARCHAR(64),
      class VARCHAR(16),
      exchange VARCHAR(16),
      status VARCHAR(16),
      tradable BOOLEAN
    )`);
  }

  async saveAssets(assets: AlpacaAsset[]) {
    await this.pool.query('DELETE FROM screener_assets');
    for (const a of assets) {
      await this.pool.query(
        'INSERT INTO screener_assets (symbol, name, class, exchange, status, tradable) VALUES (?, ?, ?, ?, ?, ?)',
        [a.symbol, a.name, a.class, a.exchange, a.status, a.tradable]
      );
    }
  }

  async getAllSymbols(): Promise<string[]> {
    const [rows] = await this.pool.query('SELECT symbol FROM screener_assets');
    return (rows as any[]).map(r => r.symbol);
  }
}
