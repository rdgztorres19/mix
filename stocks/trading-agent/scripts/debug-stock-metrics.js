#!/usr/bin/env node
/**
 * Script para verificar métricas de un ticker desde MySQL (training_1m).
 * Muestra OHLCV + todas las métricas precalculadas para cada vela en el rango.
 *
 * Uso:
 *   npm run debug-metrics -- GXAI 2026-03-05                # todas las velas del día
 *   npm run debug-metrics -- GXAI 2026-03-05 9:31           # desde 9:31 hasta cierre
 *   npm run debug-metrics -- GXAI 2026-03-05 9:31 10:00     # rango específico
 */

const mysql = require('mysql2/promise');

// ─── Parse args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter((a) => a !== '--');
const ticker = (args[0] || 'GXAI').toUpperCase();
const dateStr = args[1] || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const fromTime = args[2] || null;
const toTime = args[3] || null;

function timeToMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📊 Debug Stock Metrics (MySQL): ${ticker} | ${dateStr}`);
  if (fromTime && toTime) console.log(`   Rango: ${fromTime} – ${toTime} ET`);
  else if (fromTime) console.log(`   Desde: ${fromTime} ET`);
  console.log('─'.repeat(100));

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'sbrQp10',
    database: process.env.MYSQL_DATABASE_TRAINING || 'stock_training',
  });

  const [rows] = await conn.query(
    'SELECT * FROM training_1m WHERE symbol = ? AND date = ? ORDER BY candle_idx ASC',
    [ticker, dateStr],
  );

  if (!rows.length) {
    console.error(`No data for ${ticker} on ${dateStr}`);
    await conn.end();
    process.exit(1);
  }

  // Filter by time range
  let filtered = rows;
  if (fromTime) {
    const fMin = timeToMin(fromTime);
    filtered = filtered.filter((r) => timeToMin(String(r.candle_time_et)) >= fMin);
  }
  if (toTime) {
    const tMin = timeToMin(toTime);
    filtered = filtered.filter((r) => timeToMin(String(r.candle_time_et)) <= tMin);
  }

  if (!filtered.length) {
    console.error(`No candles in the specified range`);
    await conn.end();
    process.exit(1);
  }

  console.log(`Total candles: ${rows.length} | Showing: ${filtered.length}\n`);

  // ─── Table: OHLCV + key metrics + targets ────────────────────────────────
  const hdr = [
    'Time'.padEnd(6),
    'Open'.padStart(8),
    'High'.padStart(8),
    'Low'.padStart(8),
    'Close'.padStart(8),
    'Vol'.padStart(10),
    'ATR'.padStart(8),
    'VWAP'.padStart(8),
    'EMA9'.padStart(8),
    'EMA20'.padStart(8),
    'RSI'.padStart(6),
    'VolRel'.padStart(7),
    'Chg%'.padStart(8),
    'MFR10m'.padStart(8),
    'FR5m'.padStart(7),
    'Tgt'.padStart(4),
  ].join(' | ');
  console.log(hdr);
  console.log('─'.repeat(hdr.length));

  for (const r of filtered) {
    const n = (v) => Number(v || 0);
    const mfr = r.max_future_return_10m != null ? (n(r.max_future_return_10m) * 100).toFixed(1).padStart(7) + '%' : '    null';
    const fr5 = r.future_return_5m != null ? (n(r.future_return_5m) * 100).toFixed(1).padStart(6) + '%' : '   null';
    const line = [
      String(r.candle_time_et).padEnd(6),
      n(r.open).toFixed(3).padStart(8),
      n(r.high).toFixed(3).padStart(8),
      n(r.low).toFixed(3).padStart(8),
      n(r.close).toFixed(3).padStart(8),
      String(n(r.volume)).padStart(10),
      n(r.atr).toFixed(4).padStart(8),
      n(r.vwap).toFixed(3).padStart(8),
      n(r.ema9).toFixed(3).padStart(8),
      n(r.ema20).toFixed(3).padStart(8),
      r.rsi != null ? n(r.rsi).toFixed(1).padStart(6) : '  null',
      r.volume_rel != null ? n(r.volume_rel).toFixed(2).padStart(7) : '   null',
      (n(r.change_pct_at_candle) * 100).toFixed(2).padStart(7) + '%',
      mfr,
      fr5,
      r.target != null ? String(r.target).padStart(4) : 'null',
    ].join(' | ');
    console.log(line);
  }

  // ─── Summary for last candle ───────────────────────────────────────────
  const last = filtered[filtered.length - 1];
  const n = (v) => Number(v || 0);

  console.log('\n' + '═'.repeat(60));
  console.log(`Summary at ${last.candle_time_et}:`);
  console.log(`  Price:           $${n(last.close).toFixed(4)}`);
  console.log(`  Change:          ${(n(last.change_pct_at_candle) * 100).toFixed(2)}%`);
  console.log(`  ATR:             $${n(last.atr).toFixed(4)}`);
  console.log(`  VWAP:            $${n(last.vwap).toFixed(4)}`);
  console.log(`  EMA9:            $${n(last.ema9).toFixed(4)}`);
  console.log(`  EMA20:           $${n(last.ema20).toFixed(4)}`);
  console.log(`  HOD:             $${n(last.high_of_day).toFixed(4)}`);
  console.log(`  LOD:             $${n(last.low_of_day).toFixed(4)}`);
  console.log(`  Pre-market High: $${n(last.pre_market_high).toFixed(4)}`);
  console.log(`  RSI:             ${last.rsi != null ? n(last.rsi).toFixed(2) : 'null'}`);
  console.log(`  Volume Rel:      ${last.volume_rel != null ? n(last.volume_rel).toFixed(3) : 'null'}`);
  console.log(`  Gap %:           ${(n(last.gap_pct) * 100).toFixed(2)}%`);
  console.log(`  Shares Out:      ${n(last.shares_outstanding).toLocaleString()}`);
  console.log(`  Market Cap:      $${n(last.market_cap).toFixed(2)}M`);
  console.log(`  Volatility 15m:  ${last.volatility_15m != null ? n(last.volatility_15m).toFixed(4) : 'null'}`);
  console.log(`  Mom 5/10:        ${last.mom_5 != null ? n(last.mom_5).toFixed(4) : 'null'} / ${last.mom_10 != null ? n(last.mom_10).toFixed(4) : 'null'}`);
  console.log(`  Break HOD:       ${n(last.break_hod)}`);
  console.log(`  Break PM High:   ${n(last.break_pm_high)}`);
  console.log(`  Float Rotation:  ${last.float_rotation != null ? n(last.float_rotation).toFixed(4) : 'null'}`);
  console.log(`  MFR 10m:         ${last.max_future_return_10m != null ? (n(last.max_future_return_10m) * 100).toFixed(2) + '%' : 'null'}`);
  console.log(`  Target:          ${last.target}`);

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
