/**
 * MySQL helpers for serve-chart-ui.
 * Usa MYSQL_* en .env o defaults localhost:3306 admin:sbrQp10
 */

import mysql from 'mysql2/promise';

const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT || '3306', 10);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'sbrQp10';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'stock_training';

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool | null {
  if (pool) return pool;
  try {
    pool = mysql.createPool({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      database: MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 5,
    });
    return pool;
  } catch (e) {
    console.error('[MySQL] No se pudo crear el pool:', (e as Error).message);
    return null;
  }
}

export async function getDates(): Promise<string[]> {
  const p = getPool();
  if (!p) {
    console.error('[MySQL] Pool no disponible. Revisa MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD en .env');
    return [];
  }
  try {
    const [rows] = await p.query<mysql.RowDataPacket[]>(
      `SELECT DISTINCT date FROM training_1m ORDER BY date DESC LIMIT 365`,
    );
    const dates = rows.map((r) => String(r.date ?? ''));
    if (dates.length === 0) {
      console.warn('[MySQL] training_1m vacía o no existe. Ejecuta: npm run sync-mysql');
    }
    return dates;
  } catch (e) {
    console.error('[MySQL] Error en getDates:', (e as Error).message);
    return [];
  }
}

export async function getTopMovers(
  date: string,
): Promise<{ symbol: string; change_pct: number; close: number; volume: number }[]> {
  const p = getPool();
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
      [date, date],
    );
    return rows.map((r) => ({
      symbol: String(r.symbol ?? ''),
      change_pct: Number(r.change_pct ?? 0),
      close: Number(r.close ?? 0),
      volume: Number(r.volume ?? 0),
    }));
  } catch {
    return [];
  }
}

export async function getTickerData(
  ticker: string,
  date: string,
  resolution: '1m' | '5m',
): Promise<Record<string, unknown>[]> {
  const p = getPool();
  if (!p) return [];
  const table = resolution === '5m' ? 'training_5m' : 'training_1m';
  try {
    const [rows] = await p.query<mysql.RowDataPacket[]>(
      `SELECT * FROM ${table} WHERE symbol = ? AND date = ? ORDER BY candle_idx ASC`,
      [ticker.toUpperCase(), date],
    );
    return rows as unknown as Record<string, unknown>[];
  } catch {
    return [];
  }
}
