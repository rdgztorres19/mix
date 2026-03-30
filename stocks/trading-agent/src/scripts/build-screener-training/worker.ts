import * as dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import chalk from 'chalk';
import { timestampToET, type CollectorCandle } from '../../collector/indicator.calculator';
import { alpacaBarsToCandles } from '../backtest-simulator/candle-cache';
import { hasLocalData, readLocalBars, readLocalPrevClose } from '../data-downloader/file-cache';
import { createPool, getStockProfiles } from '../backtest-simulator/db';
import { BacktestScreener, type CombinedResultWide } from '../backtest-simulator/screener';
import { IndicatorEngine } from '../backtest-simulator/indicator-engine';
import { PredictorClient } from '../backtest-simulator/predictor-client';
import { TradeSimulator } from '../backtest-simulator/trade-simulator';
import { applyFilters, buildTradeContext } from '../backtest-simulator/trade-filters';
import type { ScreenerRankType } from '../../scanner/screener/persistence/screener.repository';
import type { StockProfile, PredictPayload, PredictResult } from '../backtest-simulator/types';

// ── Config ───────────────────────────────────────────────────────────────────

const MARKET_OPEN_MINUTE = 9 * 60 + 30;
const SCREENER_TOP_N = 40;        // per-ranker top N
const SCREENER_MIN_VOLUME = 500_000;
const WIDE_LIMIT = 100;           // wide screener output limit
const SIM_START = '09:30';
const SIM_END = '11:30';
const THRESHOLD = 0.65;
const TARGET_PCT = 4;
const STOP_LOSS_PCT = 2;
const LOOK_AHEAD = 120;
const PARALLEL_MINUTES = 20;
const MAX_SIGNALS_PER_STOCK = 3;
const CSV_HEADER = [
  'symbol', 'date',
  // Profile features
  'price', 'gap_pct', 'premarket_volume', 'shares_outstanding', 'market_cap',
  'atr_pct', 'volume_at_entry', 'dist_hod_pct', 'time_of_first_entry_min',
  // Ranking metadata
  'in_gapper', 'in_gainer_session', 'in_gainer_intraday', 'in_high_session', 'in_high_current',
  'rank_gapper', 'rank_gainer_session', 'rank_gainer_intraday', 'rank_high_session', 'rank_high_current',
  'num_ranking_types', 'max_metric_value', 'combined_rank',
  // Labels
  'total_signals', 'wins', 'losses', 'neutrals',
  'win_rate', 'avg_pnl', 'total_pnl', 'has_winning_trade',
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

// ── Per-symbol tracking ──────────────────────────────────────────────────────

interface SymbolEntry {
  firstSeenMs: number;
  price: number;
  gapPct: number;
  premarketVolume: number;
  sharesOutstanding: number;
  marketCap: number;
  atrPct: number;
  volumeAtEntry: number;
  distHodPct: number;
  timeOfFirstEntryMin: number;
  reasons: Set<ScreenerRankType>;
  rankPositions: Map<ScreenerRankType, number>;
  maxMetricValue: number;
  combinedRank: number;
  totalSignals: number;
  wins: number;
  losses: number;
  neutrals: number;
  totalPnl: number;
}

interface DayResult {
  date: string;
  rows: string[];
  withSignals: number;
  totalWins: number;
  totalLosses: number;
  elapsed: number;
}

// ── Process a single date ────────────────────────────────────────────────────

async function processDate(
  date: string,
  label: string,
  profiles: Map<string, StockProfile>,
): Promise<DayResult> {
  const t0 = Date.now();

  const allBarsMap = await readLocalBars(date);
  const prevCloseMap = await readLocalPrevClose(date);
  console.log(chalk.dim(`  ${date} ◈ Loaded ${allBarsMap.size} symbols, ${prevCloseMap.size} prev_close`));

  // Pre-index candles sorted by time + pre-filter symbols with enough volume
  const candlesBySymbol = new Map<string, CollectorCandle[]>();
  const startTimeMs = etToUnixMs(date, SIM_START);
  const endTimeMs = etToUnixMs(date, SIM_END);
  let skippedLowVol = 0;
  for (const [sym, bars] of allBarsMap) {
    const candles = alpacaBarsToCandles(bars);
    if (candles.length === 0) continue;
    // Pre-filter: only keep symbols with total volume >= minVolume/2
    // (the screener will do the real filter, this just avoids processing dead symbols)
    let totalVol = 0;
    for (const c of candles) {
      if (c.t <= endTimeMs) totalVol += c.v;
    }
    if (totalVol < SCREENER_MIN_VOLUME / 2) { skippedLowVol++; continue; }
    // Ensure sorted by timestamp
    candles.sort((a, b) => a.t - b.t);
    candlesBySymbol.set(sym.toUpperCase(), candles);
  }
  console.log(chalk.dim(`  ${date} ◈ ${candlesBySymbol.size} symbols with candles (${skippedLowVol} low-vol skipped)`));

  const screener = new BacktestScreener(SCREENER_TOP_N, SCREENER_MIN_VOLUME);
  const indicatorEngine = new IndicatorEngine();
  const predictorClient = new PredictorClient();
  const tradeSimulator = new TradeSimulator(TARGET_PCT, STOP_LOSS_PCT, LOOK_AHEAD);

  const startMin = timeToMinutes(SIM_START);
  const endMin = timeToMinutes(SIM_END);

  // ── Phase 1: Wide screener + capture profile features ──
  const symbolEntries = new Map<string, SymbolEntry>();
  const everSeenSymbols = new Set<string>();
  const lastCandleCount = new Map<string, number>();

  interface MinuteData {
    min: number;
    time: string;
    timeMs: number;
    payloads: { symbol: string; payload: PredictPayload }[];
  }
  const minuteDataList: MinuteData[] = [];

  // ── Phase 1a: Run screener every 5 min to discover symbols ──
  const SCREENER_INTERVAL = 5;
  const screenerMinutes: number[] = [];
  for (let min = startMin; min <= endMin; min += SCREENER_INTERVAL) {
    screenerMinutes.push(min);
  }
  if (screenerMinutes[screenerMinutes.length - 1] !== endMin) screenerMinutes.push(endMin);

  for (let si = 0; si < screenerMinutes.length; si++) {
    const min = screenerMinutes[si];
    const currentTime = minutesToTime(min);
    const currentTimeMs = etToUnixMs(date, currentTime);
    const isAfterOpen = min > MARKET_OPEN_MINUTE;

    const pct = Math.round(((si + 1) / screenerMinutes.length) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(chalk.dim(`  ${date} ▸ Screener `) + chalk.white(currentTime) + chalk.dim(` ${bar} ${pct}%`) + chalk.cyan(` (${everSeenSymbols.size} sym)`));

    // Binary search to slice candles up to currentTimeMs
    const filteredCandles = new Map<string, CollectorCandle[]>();
    for (const [sym, candles] of candlesBySymbol) {
      let lo = 0, hi = candles.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (candles[mid].t <= currentTimeMs) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0) filteredCandles.set(sym, candles.slice(0, lo));
    }

    const synthSnapshots = screener.buildSyntheticSnapshots(filteredCandles, prevCloseMap);

    const wide: CombinedResultWide = screener.computeCombinedListWide(
      synthSnapshots, date, prevCloseMap, isAfterOpen, WIDE_LIMIT,
    );

    for (let rank = 0; rank < wide.symbols.length; rank++) {
      const sym = wide.symbols[rank];
      if (symbolEntries.has(sym)) continue;

      everSeenSymbols.add(sym);

      const history = filteredCandles.get(sym) ?? [];
      if (history.length < 2) continue;

      const prevClose = prevCloseMap.get(sym) ?? 0;
      if (prevClose <= 0) continue;

      const profile = profiles.get(sym);
      const metadata = indicatorEngine.buildMetadata(history, prevClose, profile);
      const row = indicatorEngine.buildRow(sym, history, metadata);

      const last = history[history.length - 1];
      const price = last.c;
      const atrPct = (price > 0 && row.atr) ? (row.atr / price) * 100 : 0;

      let volumeAtEntry = 0;
      for (const c of history) volumeAtEntry += c.v;

      let hod = -Infinity;
      for (const c of history) if (c.h > hod) hod = c.h;
      const distHodPct = hod > 0 ? ((price - hod) / hod) * 100 : 0;

      symbolEntries.set(sym, {
        firstSeenMs: currentTimeMs,
        price,
        gapPct: metadata.gapPct ?? 0,
        premarketVolume: metadata.premarketVolume ?? 0,
        sharesOutstanding: profile?.shares_outstanding ?? 0,
        marketCap: profile?.market_cap ?? 0,
        atrPct,
        volumeAtEntry,
        distHodPct,
        timeOfFirstEntryMin: min,
        reasons: wide.reasons.get(sym) ?? new Set(),
        rankPositions: wide.rankPositions.get(sym) ?? new Map(),
        maxMetricValue: wide.metricValues.get(sym) ?? 0,
        combinedRank: rank,
        totalSignals: 0,
        wins: 0,
        losses: 0,
        neutrals: 0,
        totalPnl: 0,
      });
    }
  }

  // ── Phase 1b: Build predict payloads every minute (only AFTER symbol was discovered) ──
  for (let min = startMin; min <= endMin; min++) {
    const currentTime = minutesToTime(min);
    const currentTimeMs = etToUnixMs(date, currentTime);

    const payloads: { symbol: string; payload: PredictPayload }[] = [];
    for (const symbol of everSeenSymbols) {
      // Only generate payloads from the minute the symbol entered the screener (no lookahead)
      const entry = symbolEntries.get(symbol);
      if (!entry || min < entry.timeOfFirstEntryMin) continue;

      const symCandles = candlesBySymbol.get(symbol);
      if (!symCandles) continue;
      // Binary search for candles up to currentTimeMs
      let lo = 0, hi = symCandles.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (symCandles[mid].t <= currentTimeMs) lo = mid + 1;
        else hi = mid;
      }
      if (lo < 2) continue;
      const prevCount = lastCandleCount.get(symbol) ?? 0;
      if (lo === prevCount) continue;
      lastCandleCount.set(symbol, lo);
      const history = symCandles.slice(0, lo);
      const prevClose = prevCloseMap.get(symbol) ?? 0;
      if (prevClose <= 0) continue;
      const meta = indicatorEngine.buildMetadata(history, prevClose, profiles.get(symbol));
      const row = indicatorEngine.buildRow(symbol, history, meta);
      const payload = indicatorEngine.buildPredictPayload(row, history);
      payloads.push({ symbol, payload });
    }

    minuteDataList.push({ min, time: currentTime, timeMs: currentTimeMs, payloads });
  }

  const totalPayloads = minuteDataList.reduce((s, m) => s + m.payloads.length, 0);
  const phase1Time = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(chalk.green(`  ${date} ✓ Phase 1`) + chalk.dim(` — ${symbolEntries.size} symbols, ${totalPayloads} payloads (${phase1Time}s)`));

  // ── Phase 2: Predict in parallel batches ──
  const minuteResults: { idx: number; predictions: PredictResult[] }[] = [];
  const signalsPerStock = new Map<string, number>();

  const t1 = Date.now();
  const totalBatches = Math.ceil(minuteDataList.length / PARALLEL_MINUTES);
  let batchNum = 0;
  for (let batch = 0; batch < minuteDataList.length; batch += PARALLEL_MINUTES) {
    batchNum++;
    const chunk = minuteDataList.slice(batch, batch + PARALLEL_MINUTES);
    const payloadCount = chunk.reduce((s, m) => s + m.payloads.length, 0);
    const batchPct = Math.round((batchNum / totalBatches) * 100);
    const batchBar = '█'.repeat(Math.floor(batchPct / 5)) + '░'.repeat(20 - Math.floor(batchPct / 5));
    console.log(chalk.dim(`  ${date} ▸ Predict `) + chalk.white(`${chunk[0].time}→${chunk[chunk.length - 1].time}`) + chalk.dim(` ${batchBar} ${batchPct}%`) + chalk.yellow(` (${payloadCount} payloads)`));

    const promises = chunk.map(async (md, chunkIdx) => {
      let predictions: PredictResult[] = [];
      if (md.payloads.length > 0) {
        try {
          predictions = await predictorClient.predictBatch(
            md.payloads.map((p) => p.payload),
            THRESHOLD,
          );
        } catch (err) {
          predictions = md.payloads.map(() => ({ tradeable: false, prob: 0, threshold: THRESHOLD }));
        }
      }
      return { idx: batch + chunkIdx, predictions };
    });

    const results = await Promise.all(promises);
    minuteResults.push(...results);
  }

  minuteResults.sort((a, b) => a.idx - b.idx);

  const phase2Time = ((Date.now() - t1) / 1000).toFixed(1);
  const tradeableCount = minuteResults.reduce((s, mr) => s + mr.predictions.filter(p => p.tradeable).length, 0);
  console.log(chalk.green(`  ${date} ✓ Phase 2`) + chalk.dim(` — ${tradeableCount} tradeable signals (${phase2Time}s)`));

  // ── Phase 3: Evaluate trades + aggregate per stock-day ──
  for (let i = 0; i < minuteDataList.length; i++) {
    const md = minuteDataList[i];
    const predictions = minuteResults[i]?.predictions ?? [];

    for (let j = 0; j < md.payloads.length; j++) {
      const { symbol } = md.payloads[j];
      const pred = predictions[j] ?? { tradeable: false, prob: 0, threshold: THRESHOLD };

      if (!pred.tradeable) continue;

      const entry = symbolEntries.get(symbol);
      if (!entry) continue;

      const symCandles = candlesBySymbol.get(symbol);
      const history = symCandles ? symCandles.filter(c => c.t <= md.timeMs) : [];
      const prevClose = prevCloseMap.get(symbol) ?? 0;
      const profile = profiles.get(symbol);
      const metadata = indicatorEngine.buildMetadata(history, prevClose, profile);

      const ctx = buildTradeContext(
        symbol, pred.prob, history, prevClose,
        profile?.shares_outstanding ?? 0,
        metadata.premarketVolume,
        metadata.gapPct,
      );
      const { pass } = applyFilters(ctx);
      if (!pass) continue;

      const symSignalCount = signalsPerStock.get(symbol) ?? 0;
      if (symSignalCount >= MAX_SIGNALS_PER_STOCK) continue;
      signalsPerStock.set(symbol, symSignalCount + 1);

      const allCandles = candlesBySymbol.get(symbol) ?? [];
      const entryIdx = history.length - 1;
      const trade = tradeSimulator.evaluate(allCandles, entryIdx);

      entry.totalSignals++;
      if (trade.result === 'win') { entry.wins++; entry.totalPnl += trade.pnlPct; }
      else if (trade.result === 'loss') { entry.losses++; entry.totalPnl += trade.pnlPct; }
      else { entry.neutrals++; }
    }
  }

  // ── Build CSV rows in memory ──
  const rows: string[] = [];
  for (const [sym, e] of symbolEntries) {
    const winRate = e.totalSignals > 0 ? e.wins / e.totalSignals : 0;
    const avgPnl = e.totalSignals > 0 ? e.totalPnl / e.totalSignals : 0;
    const hasWinningTrade = e.wins > 0 ? 1 : 0;

    rows.push([
      sym, date,
      e.price, e.gapPct.toFixed(2), e.premarketVolume, e.sharesOutstanding, e.marketCap,
      e.atrPct.toFixed(4), e.volumeAtEntry, e.distHodPct.toFixed(4), e.timeOfFirstEntryMin,
      e.reasons.has('gapper') ? 1 : 0,
      e.reasons.has('gainer_session') ? 1 : 0,
      e.reasons.has('gainer_intraday') ? 1 : 0,
      e.reasons.has('high_session') ? 1 : 0,
      e.reasons.has('high_current') ? 1 : 0,
      e.rankPositions.get('gapper') ?? -1,
      e.rankPositions.get('gainer_session') ?? -1,
      e.rankPositions.get('gainer_intraday') ?? -1,
      e.rankPositions.get('high_session') ?? -1,
      e.rankPositions.get('high_current') ?? -1,
      e.reasons.size,
      e.maxMetricValue.toFixed(4),
      e.combinedRank,
      e.totalSignals, e.wins, e.losses, e.neutrals,
      winRate.toFixed(4), avgPnl.toFixed(4), e.totalPnl.toFixed(4), hasWinningTrade,
    ].map(escapeCsv).join(','));
  }

  const withSignals = [...symbolEntries.values()].filter(e => e.totalSignals > 0).length;
  const totalWins = [...symbolEntries.values()].reduce((s, e) => s + e.wins, 0);
  const totalLosses = [...symbolEntries.values()].reduce((s, e) => s + e.losses, 0);
  const elapsed = (Date.now() - t0) / 1000;

  console.log(chalk.green.bold(`  ${date} ✓ Done`) + chalk.dim(` — `) +
    chalk.white(`${rows.length} rows`) + chalk.dim(', ') +
    chalk.cyan(`${withSignals} with signals`) + chalk.dim(', ') +
    chalk.green(`${totalWins}W`) + chalk.dim('/') + chalk.red(`${totalLosses}L`) + chalk.dim(` (${elapsed.toFixed(1)}s)`));

  return { date, rows, withSignals, totalWins, totalLosses, elapsed };
}

// ── Worker entry point (called by main.ts via child_process.fork) ────────────

async function run() {
  // Args: workerIdx, startDate, endDate, outputPath, totalDays
  const args = process.argv.slice(2);
  const workerIdx = parseInt(args[0]);
  const startDate = args[1];
  const endDate = args[2];
  const outputPath = args[3];
  const totalDaysGlobal = parseInt(args[4]) || 0;

  if (!startDate || !outputPath) {
    console.error('Worker usage: worker.ts WORKER_IDX START_DATE END_DATE OUTPUT_PATH [TOTAL_DAYS]');
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

  // Write CSV (no header — main.ts writes the header)
  const writeStream = fs.createWriteStream(outputPath, { flags: 'w' });

  let totalRows = 0;
  let completed = 0;

  for (let d = 0; d < businessDays.length; d++) {
    const date = businessDays[d];

    if (!(await hasLocalData(date))) continue;

    console.log(tag + chalk.cyan.bold(` ━━━ ${date} [${d + 1}/${businessDays.length}] ━━━`));

    try {
      const result = await processDate(date, '', profiles);
      for (const row of result.rows) writeStream.write(row + '\n');

      completed++;
      totalRows += result.rows.length;
      console.log(tag + chalk.dim(` ◈ ${completed} days done, ${totalRows} rows`));

      // Notify parent process of progress
      if (process.send) {
        process.send({ type: 'progress', workerIdx, date, rows: result.rows.length, totalRows, completed });
      }
    } catch (err) {
      console.error(tag + chalk.red(` ✗ Error on ${date}: ${(err as Error).message}`));
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
