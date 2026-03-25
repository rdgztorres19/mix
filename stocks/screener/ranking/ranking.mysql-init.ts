import mysql from 'mysql2/promise';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS screener_gappers (
    symbol VARCHAR(16) NOT NULL,
    open DOUBLE,
    previous_close DOUBLE,
    gap_pct DOUBLE,
    volume BIGINT,
    rank INT,
    PRIMARY KEY(symbol)
  )`,
  `CREATE TABLE IF NOT EXISTS screener_gainers (
    symbol VARCHAR(16) NOT NULL,
    close DOUBLE,
    previous_close DOUBLE,
    pct_change DOUBLE,
    volume BIGINT,
    rank INT,
    PRIMARY KEY(symbol)
  )`,
  `CREATE TABLE IF NOT EXISTS screener_combined (
    symbol VARCHAR(16) NOT NULL PRIMARY KEY
  )`
];

export async function ensureRankingTables(pool: mysql.Pool) {
  const conn = await pool.getConnection();
  try {
    for (const sql of TABLES) {
      await conn.query(sql);
    }
  } finally {
    conn.release();
  }
}
