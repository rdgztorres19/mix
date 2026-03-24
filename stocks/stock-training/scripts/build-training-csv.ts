#!/usr/bin/env npx ts-node
import 'dotenv/config';
/**
 * Build training CSV from top_gainers.json
 *
 * For each stock+date with good performance:
 * 1. Fetch 1-min historical data for that day
 * 2. For each candle (or sampled candles), compute:
 *    - ATR, VWAP, High of Day, Low of Day, Change Today %, EMA9, EMA20
 *    - Pre-market High, Volume
 *    - Session (PRE_MARKET, THE_OPEN, LATE_MORNING, MIDDAY, THE_CLOSE, AFTER_HOURS)
 *
 * Output: CSV with one row per candle (or sampled) for training LLM/descriptive models.
 *
 * Usage:
 *   npx ts-node scripts/build-training-csv.ts [--limit 10] [--output training.csv] [--concurrency 1]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Fecha desde (YYYY-MM-DD). Si no se define, todas. */
const DATA_FROM_DATE = process.env.DATA_FROM_DATE?.trim() || null;
/** Fecha hasta (YYYY-MM-DD). Si no se define, hoy. */
const DATA_TO_DATE = process.env.DATA_TO_DATE?.trim() || null;
/** true = sobrescribir CSV, false = adicionar (retomar si falla). */
const CSV_REWRITE = process.env.CSV_REWRITE?.toLowerCase() !== 'false';
/** Límite de entradas (símbolo+fecha). Sin límite por defecto. Usa PROCESS_LIMIT=100 en .env para pruebas. */
const PROCESS_LIMIT = (() => {
  const v = process.env.PROCESS_LIMIT?.trim();
  if (!v) return 999999;
  const n = parseInt(v, 10);
  return n > 0 ? n : 999999;
})();

import { fetch1MinCandles } from '../src/data/historical-fetcher';
import { fetchFundamentals, setFundamentals } from '../src/data/fundamental-fetcher';
import { with429Retry } from '../src/data/rate-limit-429';
import { getSessionFromTimestamp } from '../src/session/session-utils';
import { calculateVwap } from '../src/indicators/vwap';
import { calculateEma } from '../src/indicators/ema';
import { calculateAtr } from '../src/indicators/atr';
import { computePremarketVolume } from '../src/features/premarket-volume.feature';
import { buildCsvRow } from '../src/csv/csv-row-builder';
import { getCsvHeader, rowToCsv } from '../src/csv/csv-writer';
import { aggregateCandlesTo5mRows } from '../src/csv/aggregate-to-5m';
import type { Candle, TopGainerEntry } from '../src/types';

const DATA_DIR = path.join(__dirname, '../data');
const TOP_GAINERS_PATH = path.join(DATA_DIR, 'top_leaders.json');

function getEtTotalMinutes(tsMsOrIso: number | string): number {
  const d = new Date(tsMsOrIso);
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getHours() * 60 + et.getMinutes();
}

/** Previous trading day (skip weekends). */
function prevTradingDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  const dow = d.getUTCDay();
  if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
  else if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Solo guardar velas entre 6:00 AM y 5:00 PM ET (premarket desde 6 AM). */
function isInTradingWindow(tsMs: number): boolean {
  const totalMin = getEtTotalMinutes(tsMs);
  return totalMin >= 4 * 60 && totalMin <= 17 * 60; // 4:00 - 17:00
}

/** Resultado de procesar un ticker: líneas CSV para 1m y 5m. */
interface ProcessResult {
  rows1m: string[];
  rows5m: string[];
  symbol: string;
  date: string;
}

/** Ejecuta hasta `concurrency` promesas en paralelo, preservando orden. */
async function promisePool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

async function processStock(entry: TopGainerEntry): Promise<ProcessResult | null> {
  const { symbol, Date: dateStr } = entry;
  const date = dateStr; // YYYY-MM-DD

  const candles = await with429Retry(() => fetch1MinCandles(symbol, date));
  if (!candles || candles.length < 20) {
    console.warn(`  [${symbol}] Skipping: insufficient candles (${candles?.length ?? 0})`);
    return null;
  }

  const fundamentals = await with429Retry(() => fetchFundamentals(symbol));

  const closes = candles.map((c: Candle) => c.c);
  const ema9Values: (number | null)[] = [];
  const ema20Values: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    ema9Values.push(calculateEma(closes.slice(0, i + 1), 9));
    ema20Values.push(calculateEma(closes.slice(0, i + 1), 20));
  }

  let priorClose = fundamentals.previousClose;
  if (priorClose == null) {
    const prevCandles = await with429Retry(() =>
      fetch1MinCandles(symbol, prevTradingDay(date))
    );
    priorClose =
      prevCandles?.length
        ? prevCandles[prevCandles.length - 1].c
        : candles[0]?.o ?? candles[0]?.c ?? 0;
  }

  priorClose = priorClose ?? candles[0]?.o ?? candles[0]?.c ?? 0;

  // NOTE:
  // This is the open of the first candle in the fetched dataset.
  // If dataset includes premarket, this is NOT the 9:30 regular-session open.
  const openDay = candles[0].o;

  // Full-day premarket aggregates are okay to precompute here.
  // The row builder will avoid using future-only values for premarket rows.
  const premarketVolume = computePremarketVolume(candles);

  const preMarketCandles = candles.filter((c: Candle) => {
    return getEtTotalMinutes(c.t) < 9 * 60 + 30;
  });

  const preMarketHigh = preMarketCandles.length
    ? Math.max(...preMarketCandles.map((c: Candle) => c.h))
    : null;

  // First regular session (9:30 ET) open for gap_pct
  const firstRegularCandle = candles.find((c: Candle) => {
    return getEtTotalMinutes(c.t) >= 9 * 60 + 30;
  });

  const openFirst = firstRegularCandle?.o ?? openDay;

  const rows1m: string[] = [];

  // Solo velas entre 6:00 AM y 5:00 PM ET
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!isInTradingWindow(c.t)) continue;

    const candlesUpToNow = candles.slice(0, i + 1);
    const atr = calculateAtr(candlesUpToNow, 14);
    const vwap = calculateVwap(candlesUpToNow);
    const changePct = priorClose > 0 ? (c.c - priorClose) / priorClose : 0;
    const session = getSessionFromTimestamp(c.t);

    const row = buildCsvRow({
      symbol,
      date,
      candle: c,
      candleIdx: i,
      candleTimeEt: new Date(c.t).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
      atr,
      vwap,
      changePctAtCandle: changePct,
      ema9: ema9Values[i],
      ema20: ema20Values[i],
      preMarketHigh,
      session,
      fundamentals,
      candles,
      priorClose,
      openDay,
      openFirst,
      premarketVolume,
    });

    rows1m.push(rowToCsv(row));
  }

  const rows5mObjs = aggregateCandlesTo5mRows({
    candles,
    symbol,
    date,
    priorClose,
    openDay,
    openFirst,
    fundamentals,
    premarketVolume,
    preMarketHigh,
    isInWindow: isInTradingWindow,
  });

  const rows5m = rows5mObjs.map((r) => rowToCsv(r));

  return { rows1m, rows5m, symbol, date };
}

async function main() {
  const args = process.argv.slice(2);
  let limit = PROCESS_LIMIT;
  let outputPath = path.join(DATA_DIR, 'training.csv');
  let concurrency = 10;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      concurrency = Math.max(1, parseInt(args[i + 1], 10));
      i++;
    }
  }

  if (!fs.existsSync(TOP_GAINERS_PATH)) {
    console.error(
      `Missing ${TOP_GAINERS_PATH}. Run: curl -o data/top_gainers.json https://www.historicalpercentgainers.com/static/top_gainers.json`
    );
    process.exit(1);
  }

  let stockProfilePath = path.join(DATA_DIR, 'stock_profile.csv');

  if (fs.existsSync(stockProfilePath)) {
    const raw = fs.readFileSync(stockProfilePath, 'utf-8');
    const stockProfiles = raw.split('\n').map((line) => line.split(','));
    for (const profile of stockProfiles) {
      const [symbol, sharesOutstanding, marketCap] = profile;
      setFundamentals(symbol, { symbol, sharesOutstanding: sharesOutstanding || null, marketCap: marketCap || null, previousClose: null });
    }
  }

  const raw = fs.readFileSync(TOP_GAINERS_PATH, 'utf-8');
  const entries: TopGainerEntry[] = JSON.parse(raw);

  const byDate = new Map<string, TopGainerEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.Date) ?? [];
    list.push(e);
    byDate.set(e.Date, list);
  }

  let sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  const dataToDate = DATA_TO_DATE || new Date().toISOString().slice(0, 10);

  if (DATA_FROM_DATE || DATA_TO_DATE) {
    sortedDates = sortedDates.filter(
      (d) => d >= (DATA_FROM_DATE || '') && d <= dataToDate
    );
    sortedDates.reverse();
    console.log(
      `Filtering: dates ${DATA_FROM_DATE || '...'} to ${dataToDate} (${sortedDates.length} dates), oldest first`
    );
  }

  const appendMode = !CSV_REWRITE;
  const outputStream = fs.createWriteStream(outputPath, {
    flags: appendMode ? 'a' : 'w',
  });

  const outputPath5m = path.join(DATA_DIR, 'training-5m.csv');
  const outputStream5m = fs.createWriteStream(outputPath5m, {
    flags: appendMode ? 'a' : 'w',
  });

  if (!appendMode) {
    outputStream.write(getCsvHeader() + '\n');
    outputStream5m.write(getCsvHeader() + '\n');
  }

  let totalRows1m = 0;
  let totalRows5m = 0;
  let processed = 0;

  for (const date of sortedDates) {
    if (processed >= limit) break;

    const list = byDate.get(date)!;
    const entries = list.filter((e) => e.percent_gain >= 10);
    const toProcess = entries.slice(0, limit - processed);
    if (toProcess.length === 0) continue;

    console.log(`Date ${date}: processing ${toProcess.length} tickers (concurrency ${concurrency})`);
    const results = await promisePool(toProcess, concurrency, processStock);

    for (const r of results) {
      if (!r) continue;

      for (const line of r.rows1m) outputStream.write(line + '\n');
      for (const line of r.rows5m) outputStream5m.write(line + '\n');

      totalRows1m += r.rows1m.length;
      totalRows5m += r.rows5m.length;
      processed++;
    }
  }

  outputStream.end();
  outputStream5m.end();

  console.log(`\nDone. Wrote ${totalRows1m} rows to ${outputPath}`);
  console.log(`Done. Wrote ${totalRows5m} rows to ${outputPath5m}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
