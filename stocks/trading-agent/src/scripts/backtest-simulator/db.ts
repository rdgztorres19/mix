import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import type { StockProfile } from './types';

export function createPool(): Pool {
  return mysql.createPool({
    host: process.env.MYSQL_HOST ?? 'localhost',
    port: parseInt(process.env.MYSQL_PORT ?? '3306', 10),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE_TRAINING ?? 'stock_training',
    waitForConnections: true,
    connectionLimit: 5,
  });
}

export async function getUniverseSymbols(pool: Pool): Promise<string[]> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT symbol FROM screener_assets
     WHERE status = 'active' AND tradable = 1
       AND class = 'us_equity' AND exchange != 'OTC'
     ORDER BY symbol`,
  );
  return rows.map((r) => String(r.symbol));
}

export async function getPrevCloseMap(pool: Pool, date: string): Promise<Map<string, number>> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT symbol, prev_close FROM screener_prev_close WHERE as_of_date = ?`,
    [date],
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    const v = Number(r.prev_close);
    if (Number.isFinite(v) && v > 0) map.set(String(r.symbol).toUpperCase(), v);
  }
  return map;
}

export async function getStockProfiles(pool: Pool): Promise<Map<string, StockProfile>> {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT symbol, shares_outstanding, market_cap FROM stock_profile`,
  );
  const map = new Map<string, StockProfile>();
  for (const r of rows) {
    map.set(String(r.symbol).toUpperCase(), {
      shares_outstanding: Number(r.shares_outstanding ?? 0),
      market_cap: Number(r.market_cap ?? 0),
    });
  }
  return map;
}
