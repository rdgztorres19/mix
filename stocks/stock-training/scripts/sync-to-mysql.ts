#!/usr/bin/env tsx
/**
 * Sincroniza training.csv y training-5m.csv a MySQL local.
 * Crea la DB si no existe, sincroniza el schema e inserta los datos.
 *
 * Uso: npm run sync-mysql
 * Requiere: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD en .env (o defaults localhost:3306 admin:sbrQp10)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { CSV_COLUMNS } from '../src/csv/csv-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const CSV_1M = path.join(DATA_DIR, 'training-enriched.csv');
const CSV_1M_FALLBACK = path.join(DATA_DIR, 'training-2p5.csv');
const CSV_1M_ORIG = path.join(DATA_DIR, 'training.csv');
const CSV_5M = path.join(DATA_DIR, 'training-5m.csv');

const MYSQL_HOST = process.env.MYSQL_HOST || 'localhost';
const MYSQL_PORT = parseInt(process.env.MYSQL_PORT || '3306', 10);
const MYSQL_USER = process.env.MYSQL_USER || 'root';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'sbrQp10';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'stock_training';

const TABLE_1M = 'training_1m';
const TABLE_5M = 'training_5m';

const SCHEMA = `
  symbol VARCHAR(16) NOT NULL,
  date DATE NOT NULL,
  candle_time_et VARCHAR(8) NOT NULL,
  candle_idx INT NOT NULL,
  open DECIMAL(20,6) NOT NULL,
  high DECIMAL(20,6) NOT NULL,
  low DECIMAL(20,6) NOT NULL,
  close DECIMAL(20,6) NOT NULL,
  volume BIGINT NOT NULL,
  atr DECIMAL(20,6) NOT NULL,
  vwap DECIMAL(20,6) NULL,
  high_of_day DECIMAL(20,6) NOT NULL,
  low_of_day DECIMAL(20,6) NOT NULL,
  change_pct_at_candle DECIMAL(20,10) NOT NULL,
  ema9 DECIMAL(20,6) NULL,
  ema20 DECIMAL(20,6) NULL,
  pre_market_high DECIMAL(20,6) NULL,
  session VARCHAR(32) NOT NULL,
  shares_outstanding DECIMAL(20,2) NULL,
  market_cap DECIMAL(20,4) NULL,
  gap_pct DECIMAL(20,10) NULL,
  premarket_volume BIGINT NULL,
  momentum_acumulado DECIMAL(20,10) NULL,
  change_1m DECIMAL(20,10) NULL,
  change_5m DECIMAL(20,10) NULL,
  change_10m DECIMAL(20,10) NULL,
  minutes_since_hod INT NULL,
  volume_rel DECIMAL(20,10) NULL,
  dist_vwap_pct DECIMAL(20,10) NULL,
  atr_rel DECIMAL(20,10) NULL,
  minute_of_day INT NULL,
  rsi DECIMAL(20,6) NULL,
  volatility_15m DECIMAL(20,10) NULL,
  mom_5 DECIMAL(20,6) NULL,
  mom_10 DECIMAL(20,6) NULL,
  return_lag_1 DECIMAL(20,10) NULL,
  return_lag_2 DECIMAL(20,10) NULL,
  return_lag_3 DECIMAL(20,10) NULL,
  dist_hod_pct DECIMAL(20,10) NULL,
  dist_lod_pct DECIMAL(20,10) NULL,
  dist_pm_high DECIMAL(20,10) NULL,
  break_hod INT NULL,
  break_pm_high INT NULL,
  range_expansion DECIMAL(20,10) NULL,
  float_rotation DECIMAL(20,10) NULL,
  dollar_volume DECIMAL(20,2) NULL,
  relative_dollar_volume DECIMAL(20,10) NULL,
  volume_spike DECIMAL(20,10) NULL,
  vwap_cross_up INT NULL,
  dist_ema9 DECIMAL(20,10) NULL,
  dist_ema20 DECIMAL(20,10) NULL,
  momentum_acceleration DECIMAL(20,10) NULL,
  is_open INT NULL,
  is_midday INT NULL,
  is_power_hour INT NULL,
  dist_gap DECIMAL(20,10) NULL,
  relative_range DECIMAL(20,10) NULL,
  future_return_5m DECIMAL(20,10) NULL,
  target TINYINT NULL,
  target_break_hod_5m INT NULL,
  max_future_return_10m DECIMAL(20,10) NULL,
  PRIMARY KEY (date, symbol, candle_idx)
`;

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) {
      values.push(current.replace(/^"|"$/g, '').trim());
      current = '';
    } else current += c;
  }
  values.push(current.replace(/^"|"$/g, '').trim());
  return values;
}

function toVal(v: string): string | number | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!isNaN(n)) return n;
  return v;
}

async function loadAndInsert(
  conn: mysql.Connection,
  csvPath: string,
  table: string,
): Promise<number> {
  if (!fs.existsSync(csvPath)) {
    console.warn(`  CSV no encontrado: ${csvPath}`);
    return 0;
  }
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length < 1) return 0;

  const firstLine = parseCsvLine(lines[0]);
  const hasHeader = firstLine.some((v) => String(v).toLowerCase() === 'symbol');
  const headers = hasHeader ? firstLine : [...CSV_COLUMNS];
  const dataStart = hasHeader ? 1 : 0;
  const cols = headers.join(', ');
  const placeholders = headers.map(() => '?').join(', ');
  const sql = `REPLACE INTO ${table} (${cols}) VALUES (${placeholders})`;

  let inserted = 0;
  const BATCH = 3500;
  let batch: unknown[] = [];

  for (let i = dataStart; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (vals.length !== headers.length) continue;
    const row = headers.map((h, j) => {
      const v = vals[j] ?? '';
      if (h === 'date') return v || null;
      return toVal(v);
    });
    batch.push(row);
    if (batch.length >= BATCH) {
      for (const r of batch as unknown[][]) {
        await conn.execute(sql, r);
        inserted++;
      }
      batch = [];
      process.stdout.write(`\r  ${table}: ${inserted} rows...`);
    }
  }
  for (const r of batch as unknown[][]) {
    await conn.execute(sql, r);
    inserted++;
  }
  return inserted;
}

async function main() {
  console.log('Conectando a MySQL...');
  let conn: mysql.Connection;
  try {
    conn = await mysql.createConnection({
      host: MYSQL_HOST,
      port: MYSQL_PORT,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      multipleStatements: true,
    });
  } catch (err) {
    console.error('Error conectando:', err);
    process.exit(1);
  }

  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\``);
    await conn.query(`USE \`${MYSQL_DATABASE}\``);
    console.log(`DB ${MYSQL_DATABASE} lista.`);

    await conn.query(`DROP TABLE IF EXISTS ${TABLE_1M}`);
    await conn.query(
      `CREATE TABLE ${TABLE_1M} (${SCHEMA}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    console.log(`Tabla ${TABLE_1M} creada.`);

    await conn.query(`DROP TABLE IF EXISTS ${TABLE_5M}`);
    await conn.query(
      `CREATE TABLE ${TABLE_5M} (${SCHEMA}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    );
    console.log(`Tabla ${TABLE_5M} creada.`);

    const csv1m = fs.existsSync(CSV_1M) ? CSV_1M : fs.existsSync(CSV_1M_FALLBACK) ? CSV_1M_FALLBACK : CSV_1M_ORIG;
    console.log('Cargando 1m desde', path.basename(csv1m), '...');
    const n1 = await loadAndInsert(conn, csv1m, TABLE_1M);
    console.log(`\n  ${TABLE_1M}: ${n1} filas insertadas.`);

    console.log('Cargando training-5m.csv...');
    const n2 = await loadAndInsert(conn, CSV_5M, TABLE_5M);
    console.log(`\n  ${TABLE_5M}: ${n2} filas insertadas.`);

    console.log('\nListo. Ejecuta npm run ui para ver los gráficos.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
