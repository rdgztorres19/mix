import * as dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// npm run build-csv -- 2024-01-01 2026-03-28

import chalk from 'chalk';
import { hasLocalData, readLocalBars, readLocalPrevClose, readLocalUvxy } from './file-cache';
import type { AlpacaBar } from './types';

// ── Config ──────────────────────────────────────────────────────────────────

const MARKET_OPEN_MINUTE = 9 * 60 + 30;  // 9:30 ET
const SIM_START_MIN = MARKET_OPEN_MINUTE;
const SIM_END_MIN = 16 * 60;             // 16:00 ET

const OUTPUT_PATH = path.resolve(__dirname, '../data/processed/sp500_training.csv');

const CSV_HEADER = [
  'date', 'candle_time_et', 'candle_idx',
  'open', 'high', 'low', 'close', 'volume',
  'atr', 'vwap', 'high_of_day', 'low_of_day',
  'change_pct', 'ema9', 'ema20',
  'pre_market_high', 'session',
  'gap_pct', 'premarket_volume',
  'change_1m', 'change_5m', 'change_10m',
  'minutes_since_hod',
  // UVXY (VIX proxy)
  'uvxy_close', 'uvxy_change_pct', 'uvxy_volume',
  // Labels (computed from future candles)
  'future_return_5m', 'future_return_10m',
  'max_future_return_10m', 'min_future_return_10m',
].join(',');

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function timestampToET(isoStr: string): { time: string; minuteOfDay: number } {
  const d = new Date(isoStr);
  const etStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const timePart = etStr.split(',')[1]?.trim() ?? '00:00:00';
  const [hStr, mStr] = timePart.split(':');
  const h = parseInt(hStr);
  const m = parseInt(mStr);
  return { time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, minuteOfDay: h * 60 + m };
}

function getSession(minuteOfDay: number): string {
  if (minuteOfDay < MARKET_OPEN_MINUTE) return 'PRE_MARKET';
  if (minuteOfDay === MARKET_OPEN_MINUTE) return 'THE_OPEN';
  if (minuteOfDay < 16 * 60) return 'REGULAR';
  return 'POST_MARKET';
}

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ── Indicator computations ──────────────────────────────────────────────────

interface Candle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  timeET: string;
  minuteOfDay: number;
}

function computeRow(candles: Candle[], idx: number, prevClose: number) {
  const c = candles[idx];
  const history = candles.slice(0, idx + 1);

  // ATR (14-period)
  const atrPeriod = Math.min(14, history.length);
  let atrSum = 0;
  for (let i = Math.max(1, history.length - atrPeriod); i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    const tr = Math.max(curr.h - curr.l, Math.abs(curr.h - prev.c), Math.abs(curr.l - prev.c));
    atrSum += tr;
  }
  const atr = atrSum / atrPeriod;

  // VWAP
  let tpvSum = 0, volSum = 0;
  for (const bar of history) {
    const tp = (bar.h + bar.l + bar.c) / 3;
    tpvSum += tp * bar.v;
    volSum += bar.v;
  }
  const vwap = volSum > 0 ? tpvSum / volSum : c.c;

  // HOD / LOD
  let hod = -Infinity, lod = Infinity;
  for (const bar of history) {
    if (bar.h > hod) hod = bar.h;
    if (bar.l < lod) lod = bar.l;
  }

  // EMA 9 / 20
  function ema(span: number): number {
    const k = 2 / (span + 1);
    let val = history[0].c;
    for (let i = 1; i < history.length; i++) {
      val = history[i].c * k + val * (1 - k);
    }
    return val;
  }
  const ema9 = ema(9);
  const ema20 = ema(20);

  // Change % from prev close
  const changePct = prevClose > 0 ? (c.c - prevClose) / prevClose : 0;

  // Pre-market high & volume
  let pmHigh = 0, pmVolume = 0;
  for (const bar of history) {
    if (bar.minuteOfDay < MARKET_OPEN_MINUTE) {
      if (bar.h > pmHigh) pmHigh = bar.h;
      pmVolume += bar.v;
    }
  }

  // Gap %
  const firstOpen = history[0].o;
  const gapPct = prevClose > 0 ? ((firstOpen - prevClose) / prevClose) * 100 : 0;

  // Change 1m, 5m, 10m
  const change1m = idx >= 1 ? (c.c - candles[idx - 1].c) / Math.max(Math.abs(candles[idx - 1].c), 1e-8) : 0;
  const change5m = idx >= 5 ? (c.c - candles[idx - 5].c) / Math.max(Math.abs(candles[idx - 5].c), 1e-8) : 0;
  const change10m = idx >= 10 ? (c.c - candles[idx - 10].c) / Math.max(Math.abs(candles[idx - 10].c), 1e-8) : 0;

  // Minutes since HOD
  let hodIdx = 0;
  for (let i = 0; i <= idx; i++) {
    if (candles[i].h >= hod) hodIdx = i;
  }
  const minutesSinceHod = idx - hodIdx;

  // Session
  const session = getSession(c.minuteOfDay);

  return {
    open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v,
    atr, vwap, high_of_day: hod, low_of_day: lod,
    change_pct: changePct, ema9, ema20,
    pre_market_high: pmHigh, session,
    gap_pct: gapPct, premarket_volume: pmVolume,
    change_1m: change1m, change_5m: change5m, change_10m: change10m,
    minutes_since_hod: minutesSinceHod,
  };
}

function computeLabels(candles: Candle[], idx: number) {
  const refClose = candles[idx].c;
  if (refClose <= 0) return { future_return_5m: 0, future_return_10m: 0, max_future_return_10m: 0, min_future_return_10m: 0 };

  const future5 = candles.slice(idx + 1, idx + 6);
  const future10 = candles.slice(idx + 1, idx + 11);

  const close5 = future5.length ? future5[future5.length - 1].c : refClose;
  const future_return_5m = (close5 - refClose) / refClose;

  const close10 = future10.length ? future10[future10.length - 1].c : refClose;
  const future_return_10m = (close10 - refClose) / refClose;

  const maxHigh10 = future10.length ? Math.max(...future10.map(c => c.h)) : refClose;
  const max_future_return_10m = (maxHigh10 - refClose) / refClose;

  const minLow10 = future10.length ? Math.min(...future10.map(c => c.l)) : refClose;
  const min_future_return_10m = (minLow10 - refClose) / refClose;

  return { future_return_5m, future_return_10m, max_future_return_10m, min_future_return_10m };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const startDate = args[0];
  const endDate = args[1] || startDate;
  const outputPath = args[2] || OUTPUT_PATH;

  if (!startDate) {
    console.error('Usage: npm run build-csv -- START_DATE [END_DATE] [OUTPUT_PATH]');
    process.exit(1);
  }

  const businessDays = getBusinessDays(startDate, endDate);
  console.log(chalk.bgBlue.white.bold('\n  SP500 Build Training CSV (1min)  '));
  console.log(chalk.dim(`  Range: ${startDate} → ${endDate} | Days: ${businessDays.length}`));
  console.log(chalk.dim(`  Output: ${outputPath}\n`));

  // Ensure output dir
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const writeStream = fs.createWriteStream(outputPath, { flags: 'w' });
  writeStream.write(CSV_HEADER + '\n');

  let totalRows = 0;

  for (let d = 0; d < businessDays.length; d++) {
    const date = businessDays[d];
    const label = `[${d + 1}/${businessDays.length}] ${date}`;

    if (!(await hasLocalData(date))) {
      console.log(chalk.yellow(`${label} — no local data, skipping`));
      continue;
    }

    console.log(chalk.cyan(`${label} — processing...`));

    const rawBars = await readLocalBars(date);
    const prevClose = await readLocalPrevClose(date);

    if (rawBars.length === 0 || prevClose <= 0) {
      console.log(chalk.yellow(`  No valid data, skipping`));
      continue;
    }

    // Load UVXY bars and build a minute-keyed lookup
    const uvxyRaw = await readLocalUvxy(date);
    const uvxyByMinute = new Map<string, { c: number; v: number }>();
    let uvxyPrevClose = 0;
    for (const bar of uvxyRaw) {
      const { time } = timestampToET(bar.t);
      uvxyByMinute.set(time, { c: bar.c, v: bar.v });
      if (!uvxyPrevClose && bar.c > 0) uvxyPrevClose = bar.o; // first bar open as baseline
    }

    // Convert to candles with ET time
    const candles: Candle[] = rawBars.map(bar => {
      const { time, minuteOfDay } = timestampToET(bar.t);
      return { t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v, timeET: time, minuteOfDay };
    });

    // Process all candles (including pre-market)
    let dayRows = 0;
    for (let i = 0; i < candles.length; i++) {
      const row = computeRow(candles, i, prevClose);
      const labels = computeLabels(candles, i);

      // UVXY data for this minute
      const uvxy = uvxyByMinute.get(candles[i].timeET);
      const uvxyClose = uvxy?.c ?? 0;
      const uvxyVol = uvxy?.v ?? 0;
      const uvxyChangePct = uvxyPrevClose > 0 && uvxyClose > 0
        ? (uvxyClose - uvxyPrevClose) / uvxyPrevClose
        : 0;

      const csvLine = [
        date, candles[i].timeET, i,
        row.open, row.high, row.low, row.close, row.volume,
        row.atr, row.vwap, row.high_of_day, row.low_of_day,
        row.change_pct, row.ema9, row.ema20,
        row.pre_market_high, row.session,
        row.gap_pct, row.premarket_volume,
        row.change_1m, row.change_5m, row.change_10m,
        row.minutes_since_hod,
        uvxyClose, uvxyChangePct, uvxyVol,
        labels.future_return_5m, labels.future_return_10m,
        labels.max_future_return_10m, labels.min_future_return_10m,
      ].map(escapeCsv).join(',');

      writeStream.write(csvLine + '\n');
      dayRows++;
    }

    totalRows += dayRows;
    console.log(chalk.green(`  ${dayRows} rows`));
  }

  writeStream.end();
  console.log(chalk.green.bold(`\nDone! ${totalRows} rows → ${outputPath}`));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
