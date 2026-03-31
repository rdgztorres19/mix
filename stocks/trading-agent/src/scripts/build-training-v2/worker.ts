import * as dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import chalk from 'chalk';
import { timestampToET, computeCandleRow, type CollectorCandle, type SymbolMetadata } from '../../collector/indicator.calculator';
import { alpacaBarsToCandles } from '../backtest-simulator/candle-cache';
import { hasLocalData, readLocalBars, readLocalPrevClose } from '../data-downloader/file-cache';
import { createPool, getStockProfiles } from '../backtest-simulator/db';
import { BacktestScreener } from '../backtest-simulator/screener';
import type { StockProfile } from '../backtest-simulator/types';

// ── Config ───────────────────────────────────────────────────────────────────

const MARKET_OPEN_MINUTE = 9 * 60 + 30;
const SCREENER_TOP_N = 40;
const SCREENER_MIN_VOLUME = 500_000;
const SIM_START = '09:30';
const SIM_END = '16:00';
const SCREENER_INTERVAL = 5;
const MIN_DAILY_VOL = 250_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function getBusinessDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  let current = new Date(startDate + 'T12:00:00Z');
  const end = new Date(endDate + 'T12:00:00Z');
  while (current <= end) {
    if (isWeekday(current)) days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function etToUnixMs(dateStr: string, timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  const targetDate = new Date(`${dateStr}T12:00:00Z`);
  const utcStr = targetDate.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
  const etStr = targetDate.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const utcHour = parseInt(utcStr.split(',')[1].trim().split(':')[0]);
  const etHour = parseInt(etStr.split(',')[1].trim().split(':')[0]);
  let offset = etHour - utcHour;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  return Date.UTC(
    parseInt(dateStr.slice(0, 4)),
    parseInt(dateStr.slice(5, 7)) - 1,
    parseInt(dateStr.slice(8, 10)),
    h - offset, m, 0,
  );
}

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function bsearch(candles: CollectorCandle[], timeMs: number): number {
  let lo = 0, hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid].t <= timeMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ── Labels ───────────────────────────────────────────────────────────────────

function computeLabels(allCandles: CollectorCandle[], idx: number) {
  const refClose = allCandles[idx].c;
  if (refClose <= 0) return { future_return_5m: 0, target: 0, target_break_hod_5m: 0, max_future_return_10m: 0 };

  const future5 = allCandles.slice(idx + 1, idx + 6);
  const future10 = allCandles.slice(idx + 1, idx + 11);

  const close5 = future5.length ? future5[future5.length - 1].c : refClose;
  const future_return_5m = (close5 - refClose) / refClose;
  const target = future_return_5m > 0 ? 1 : future_return_5m < 0 ? -1 : 0;

  const maxHigh10 = future10.length ? Math.max(...future10.map(c => c.h)) : refClose;
  const max_future_return_10m = (maxHigh10 - refClose) / refClose;

  let hodUpToIdx = -Infinity;
  for (let i = 0; i <= idx; i++) if (allCandles[i].h > hodUpToIdx) hodUpToIdx = allCandles[i].h;
  const target_break_hod_5m = future5.some(c => c.h > hodUpToIdx) ? 1 : 0;

  return { future_return_5m, target, target_break_hod_5m, max_future_return_10m };
}

function buildMetadata(
  candles: CollectorCandle[],
  prevClose: number,
  profile: StockProfile | undefined,
): SymbolMetadata {
  let preMarketHigh = 0;
  let premarketVolume = 0;
  for (const c of candles) {
    const { minuteOfDay } = timestampToET(c.t);
    if (minuteOfDay < MARKET_OPEN_MINUTE) {
      if (c.h > preMarketHigh) preMarketHigh = c.h;
      premarketVolume += c.v;
    }
  }
  const firstOpen = candles.length > 0 ? candles[0].o : 0;
  const gapPct = prevClose > 0 ? ((firstOpen - prevClose) / prevClose) * 100 : 0;

  return {
    priorClose: prevClose,
    preMarketHigh,
    sharesOutstanding: profile?.shares_outstanding ?? null,
    marketCap: profile?.market_cap ?? null,
    gapPct,
    premarketVolume,
  };
}

// ── Process a single date ────────────────────────────────────────────────────

function processDate(
  date: string,
  candlesBySymbol: Map<string, CollectorCandle[]>,
  prevCloseMap: Map<string, number>,
  profiles: Map<string, StockProfile>,
): string[] {
  const screener = new BacktestScreener(SCREENER_TOP_N, SCREENER_MIN_VOLUME);
  const startMin = timeToMinutes(SIM_START);
  const endMin = timeToMinutes(SIM_END);
  const firstSeenAt = new Map<string, number>();

  // Screener every 5 min (optimized)
  for (let min = startMin; min <= endMin; min += SCREENER_INTERVAL) {
    const currentTimeMs = etToUnixMs(date, minutesToTime(min));
    const isAfterOpen = min > MARKET_OPEN_MINUTE;

    const filteredCandles = new Map<string, CollectorCandle[]>();
    for (const [sym, candles] of candlesBySymbol) {
      const n = bsearch(candles, currentTimeMs);
      if (n > 0) filteredCandles.set(sym, candles.slice(0, n));
    }

    const synthSnapshots = screener.buildSyntheticSnapshots(filteredCandles, prevCloseMap);
    const { symbols: combinedList } = screener.computeCombinedList(
      synthSnapshots, date, prevCloseMap, isAfterOpen,
    );

    for (const sym of combinedList) {
      if (!firstSeenAt.has(sym)) {
        firstSeenAt.set(sym, currentTimeMs);
      }
    }
  }

  // Emit candles for each discovered symbol
  const rows: string[] = [];
  for (const [sym, entryTimeMs] of firstSeenAt) {
    const allCandles = candlesBySymbol.get(sym);
    if (!allCandles || allCandles.length < 5) continue;

    const prevClose = prevCloseMap.get(sym) ?? 0;
    if (prevClose <= 0) continue;

    const profile = profiles.get(sym);
    const metadata = buildMetadata(allCandles, prevClose, profile);

    for (let i = 0; i < allCandles.length; i++) {
      const history = allCandles.slice(0, i + 1);
      const row = computeCandleRow(sym, history, metadata);
      const labels = computeLabels(allCandles, i);
      const { time } = timestampToET(allCandles[i].t);
      const validForTraining = allCandles[i].t >= entryTimeMs ? 1 : 0;

      rows.push([
        sym, date, time, i,
        row.open, row.high, row.low, row.close, row.volume,
        row.atr, row.vwap, row.high_of_day, row.low_of_day,
        row.change_pct_at_candle, row.ema9, row.ema20,
        row.pre_market_high, row.session,
        row.shares_outstanding, row.market_cap, row.gap_pct, row.premarket_volume,
        row.momentum_acumulado, row.change_1m, row.change_5m, row.change_10m,
        row.minutes_since_hod,
        labels.future_return_5m, labels.target, labels.target_break_hod_5m,
        labels.max_future_return_10m,
        validForTraining,
      ].map(escapeCsv).join(','));
    }
  }

  return rows;
}

// ── Worker entry point ───────────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);
  const workerIdx = parseInt(args[0]);
  const startDate = args[1];
  const endDate = args[2];
  const outputPath = args[3];

  if (!startDate || !outputPath) {
    console.error('Worker usage: worker.ts WORKER_IDX START_DATE END_DATE OUTPUT_PATH');
    process.exit(1);
  }

  const tag = chalk.magenta(`[W${workerIdx}]`);
  const businessDays = getBusinessDays(startDate, endDate);
  console.log(tag + chalk.dim(` ${startDate} → ${endDate} | ${businessDays.length} days → ${outputPath}`));

  const pool = createPool();
  let profiles: Map<string, StockProfile>;
  try {
    profiles = await getStockProfiles(pool);
  } finally {
    await pool.end();
  }

  const writeStream = fs.createWriteStream(outputPath, { flags: 'w' });
  let totalRows = 0;
  let completed = 0;

  for (let d = 0; d < businessDays.length; d++) {
    const date = businessDays[d];
    if (!(await hasLocalData(date))) continue;

    const t0 = Date.now();
    const allBarsMap = await readLocalBars(date);
    const prevCloseMap = await readLocalPrevClose(date);

    // Pre-index + filter low volume
    const candlesBySymbol = new Map<string, CollectorCandle[]>();
    let skipped = 0;
    for (const [sym, bars] of allBarsMap) {
      const candles = alpacaBarsToCandles(bars);
      if (candles.length === 0) continue;
      let totalVol = 0;
      for (const c of candles) totalVol += c.v;
      if (totalVol < MIN_DAILY_VOL) { skipped++; continue; }
      candles.sort((a, b) => a.t - b.t);
      candlesBySymbol.set(sym.toUpperCase(), candles);
    }

    const rows = processDate(date, candlesBySymbol, prevCloseMap, profiles);
    for (const row of rows) writeStream.write(row + '\n');

    completed++;
    totalRows += rows.length;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(tag + chalk.green(` ${date}`) + chalk.dim(` — ${rows.length} rows, ${candlesBySymbol.size} sym (${skipped} skipped) ${elapsed}s`));

    if (process.send) {
      process.send({ type: 'progress', workerIdx, date, rows: rows.length, totalRows, completed });
    }
  }

  writeStream.end();
  console.log(tag + chalk.green.bold(` Done! ${totalRows} rows → ${outputPath}`));

  if (process.send) {
    process.send({ type: 'done', workerIdx, totalRows, completed });
  }
}

run().catch((err) => {
  console.error('Worker fatal error:', err);
  process.exit(1);
});
