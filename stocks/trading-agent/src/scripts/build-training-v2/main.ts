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

const CSV_HEADER = [
  'symbol', 'date', 'candle_time_et', 'candle_idx',
  'open', 'high', 'low', 'close', 'volume',
  'atr', 'vwap', 'high_of_day', 'low_of_day',
  'change_pct_at_candle', 'ema9', 'ema20',
  'pre_market_high', 'session',
  'shares_outstanding', 'market_cap', 'gap_pct', 'premarket_volume',
  'momentum_acumulado', 'change_1m', 'change_5m', 'change_10m',
  'minutes_since_hod',
  'future_return_5m', 'target', 'target_break_hod_5m', 'max_future_return_10m',
].join(',');

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

// ── Labels (computed from full-day candles) ──────────────────────────────────

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

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const startDate = args[0];
  const endDate = args[1] || startDate;
  const outputPath = args[2] || path.resolve(__dirname, '../../../../stock-training/data/training-v2.csv');

  if (!startDate) {
    console.error('Usage: ts-node main.ts START_DATE [END_DATE] [OUTPUT_PATH]');
    process.exit(1);
  }

  const businessDays = getBusinessDays(startDate, endDate);
  console.log(chalk.bgBlue.white.bold('\n  Build Training V2  '));
  console.log(chalk.dim(`  Range: ${startDate} → ${endDate} | Days: ${businessDays.length}`));
  console.log(chalk.dim(`  Output: ${outputPath}\n`));

  const pool = createPool();
  let profiles: Map<string, StockProfile>;

  try {
    profiles = await getStockProfiles(pool);
    console.log(chalk.dim(`  Stock profiles: ${profiles.size}`));
  } finally {
    await pool.end();
  }

  // Write CSV header
  const writeStream = fs.createWriteStream(outputPath, { flags: 'w' });
  writeStream.write(CSV_HEADER + '\n');

  let totalRows = 0;
  let totalSymbols = 0;

  for (let d = 0; d < businessDays.length; d++) {
    const date = businessDays[d];
    const label = `[${d + 1}/${businessDays.length}] ${date}`;

    if (!(await hasLocalData(date))) {
      console.log(chalk.yellow(`${label} — no local data, skipping (run download-data first)`));
      continue;
    }

    console.log(chalk.cyan(`${label} — processing...`));
    const allBarsMap = await readLocalBars(date);
    const prevCloseMap = await readLocalPrevClose(date);

    // Convert all bars to candles
    const allCandlesMap = new Map<string, CollectorCandle[]>();
    allBarsMap.forEach((bars, sym) => {
      allCandlesMap.set(sym, alpacaBarsToCandles(bars));
    });

    // Run screener simulation to find which symbols enter the combined list
    // and WHEN they first enter (to avoid lookahead bias)
    const screener = new BacktestScreener(SCREENER_TOP_N, SCREENER_MIN_VOLUME);
    const startMin = timeToMinutes(SIM_START);
    const endMin = timeToMinutes(SIM_END);
    const firstSeenAt = new Map<string, number>(); // symbol → unix ms when first seen

    for (let min = startMin; min <= endMin; min++) {
      const currentTime = minutesToTime(min);
      const currentTimeMs = etToUnixMs(date, currentTime);
      const isAfterOpen = min > MARKET_OPEN_MINUTE;

      const candlesUpTo = new Map<string, CollectorCandle[]>();
      allCandlesMap.forEach((candles, sym) => {
        const upTo = candles.filter(c => c.t <= currentTimeMs);
        if (upTo.length > 0) candlesUpTo.set(sym, upTo);
      });

      const synthSnapshots = screener.buildSyntheticSnapshots(candlesUpTo, prevCloseMap);
      const { symbols: combinedList } = screener.computeCombinedList(
        synthSnapshots, date, prevCloseMap, isAfterOpen,
      );

      for (const sym of combinedList) {
        if (!firstSeenAt.has(sym)) {
          firstSeenAt.set(sym, currentTimeMs);
        }
      }
    }

    console.log(chalk.dim(`  Screener found ${firstSeenAt.size} unique symbols`));

    // For each symbol that ever appeared in the combined list, emit ALL its candles
    // (full history from pre-market for correct ATR/EMA/VWAP)
    let dayRows = 0;
    for (const [sym, entryTimeMs] of firstSeenAt) {
      const allCandles = allCandlesMap.get(sym);
      if (!allCandles || allCandles.length < 5) continue;

      const prevClose = prevCloseMap.get(sym) ?? 0;
      if (prevClose <= 0) continue;

      const profile = profiles.get(sym);
      const metadata: SymbolMetadata = buildMetadata(allCandles, prevClose, profile);

      for (let i = 0; i < allCandles.length; i++) {
        const history = allCandles.slice(0, i + 1);
        const row = computeCandleRow(sym, history, metadata);
        const labels = computeLabels(allCandles, i);
        const { time } = timestampToET(allCandles[i].t);

        const csvLine = [
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
        ].map(escapeCsv).join(',');

        writeStream.write(csvLine + '\n');
        dayRows++;
      }
    }

    totalRows += dayRows;
    totalSymbols += firstSeenAt.size;
    console.log(chalk.green(`  ${dayRows} rows from ${firstSeenAt.size} symbols`));
  }

  writeStream.end();
  console.log(chalk.green.bold(`\nDone! ${totalRows} rows, ${totalSymbols} symbol-days → ${outputPath}`));
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

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
