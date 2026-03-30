import * as dotenv from 'dotenv';
import path from 'path';

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
const SCREENER_TOP_N = 40;
const SCREENER_MIN_VOLUME = 500_000;
const WIDE_LIMIT = 100;
const SIM_START = '09:30';
const SIM_END = '11:30';
const THRESHOLD = 0.65;
const TARGET_PCT = 4;
const STOP_LOSS_PCT = 2;
const LOOK_AHEAD = 120;
const PARALLEL_MINUTES = 20;
const MAX_SIGNALS_PER_STOCK = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Per-symbol tracking ──────────────────────────────────────────────────────

interface SymbolEntry {
  price: number;
  gapPct: number;
  premarketVolume: number;
  atrPct: number;
  distHodPct: number;
  timeOfFirstEntryMin: number;
  reasons: Set<ScreenerRankType>;
  combinedRank: number;
  totalSignals: number;
  wins: number;
  losses: number;
  neutrals: number;
  totalPnl: number;
  trades: { time: string; prob: number; result: string; pnl: number }[];
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const date = process.argv[2];
  if (!date) {
    console.error('Usage: ts-node debug-day.ts 2026-03-27');
    process.exit(1);
  }

  console.log(chalk.bgMagenta.white.bold(`\n  Debug Wide Screener — ${date}  `));
  console.log(chalk.dim(`  Wide: ${WIDE_LIMIT} | Thr: ${THRESHOLD} | TP: ${TARGET_PCT}% SL: ${STOP_LOSS_PCT}%\n`));

  if (!(await hasLocalData(date))) {
    console.error(chalk.red('No local data for this date'));
    process.exit(1);
  }

  const pool = createPool();
  const profiles = await getStockProfiles(pool);
  await pool.end();

  const allBarsMap = await readLocalBars(date);
  const prevCloseMap = await readLocalPrevClose(date);

  // Pre-index candles
  const candlesBySymbol = new Map<string, CollectorCandle[]>();
  const endTimeMs = etToUnixMs(date, SIM_END);
  for (const [sym, bars] of allBarsMap) {
    const candles = alpacaBarsToCandles(bars);
    if (candles.length === 0) continue;
    let totalVol = 0;
    for (const c of candles) { if (c.t <= endTimeMs) totalVol += c.v; }
    if (totalVol < SCREENER_MIN_VOLUME / 2) continue;
    candles.sort((a, b) => a.t - b.t);
    candlesBySymbol.set(sym.toUpperCase(), candles);
  }

  console.log(chalk.dim(`  ${candlesBySymbol.size} symbols with candles\n`));

  const screener = new BacktestScreener(SCREENER_TOP_N, SCREENER_MIN_VOLUME);
  const indicatorEngine = new IndicatorEngine();
  const predictorClient = new PredictorClient();
  const tradeSimulator = new TradeSimulator(TARGET_PCT, STOP_LOSS_PCT, LOOK_AHEAD);

  const startMin = timeToMinutes(SIM_START);
  const endMin = timeToMinutes(SIM_END);

  // ── Phase 1a: Wide screener every 5 min ──
  const symbolEntries = new Map<string, SymbolEntry>();
  const everSeenSymbols = new Set<string>();
  const lastCandleCount = new Map<string, number>();

  const SCREENER_INTERVAL = 5;
  const screenerMinutes: number[] = [];
  for (let min = startMin; min <= endMin; min += SCREENER_INTERVAL) screenerMinutes.push(min);
  if (screenerMinutes[screenerMinutes.length - 1] !== endMin) screenerMinutes.push(endMin);

  for (const min of screenerMinutes) {
    const currentTime = minutesToTime(min);
    const currentTimeMs = etToUnixMs(date, currentTime);
    const isAfterOpen = min > MARKET_OPEN_MINUTE;

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
    const wide = screener.computeCombinedListWide(synthSnapshots, date, prevCloseMap, isAfterOpen, WIDE_LIMIT);

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
      let hod = -Infinity;
      for (const c of history) if (c.h > hod) hod = c.h;
      const distHodPct = hod > 0 ? ((price - hod) / hod) * 100 : 0;

      symbolEntries.set(sym, {
        price,
        gapPct: metadata.gapPct ?? 0,
        premarketVolume: metadata.premarketVolume ?? 0,
        atrPct,
        distHodPct,
        timeOfFirstEntryMin: min,
        reasons: wide.reasons.get(sym) ?? new Set(),
        combinedRank: rank,
        totalSignals: 0, wins: 0, losses: 0, neutrals: 0, totalPnl: 0,
        trades: [],
      });
    }
  }

  console.log(chalk.cyan(`  Phase 1: ${symbolEntries.size} symbols in wide screener\n`));

  // ── Phase 1b: Build payloads every minute (only AFTER symbol was discovered) ──
  interface MinuteData {
    min: number; time: string; timeMs: number;
    payloads: { symbol: string; payload: PredictPayload }[];
  }
  const minuteDataList: MinuteData[] = [];

  for (let min = startMin; min <= endMin; min++) {
    const currentTime = minutesToTime(min);
    const currentTimeMs = etToUnixMs(date, currentTime);

    const payloads: { symbol: string; payload: PredictPayload }[] = [];
    for (const symbol of everSeenSymbols) {
      // No lookahead: only generate payloads from when the stock entered the screener
      const entry = symbolEntries.get(symbol);
      if (!entry || min < entry.timeOfFirstEntryMin) continue;

      const symCandles = candlesBySymbol.get(symbol);
      if (!symCandles) continue;
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
  console.log(chalk.cyan(`  Phase 1b: ${totalPayloads} payloads\n`));

  // ── Phase 2: Predict ──
  const minuteResults: { idx: number; predictions: PredictResult[] }[] = [];
  const signalsPerStock = new Map<string, number>();

  for (let batch = 0; batch < minuteDataList.length; batch += PARALLEL_MINUTES) {
    const chunk = minuteDataList.slice(batch, batch + PARALLEL_MINUTES);
    const promises = chunk.map(async (md, chunkIdx) => {
      let predictions: PredictResult[] = [];
      if (md.payloads.length > 0) {
        try {
          predictions = await predictorClient.predictBatch(md.payloads.map(p => p.payload), THRESHOLD);
        } catch { predictions = md.payloads.map(() => ({ tradeable: false, prob: 0, threshold: THRESHOLD })); }
      }
      return { idx: batch + chunkIdx, predictions };
    });
    minuteResults.push(...await Promise.all(promises));
  }
  minuteResults.sort((a, b) => a.idx - b.idx);

  // ── Phase 3: Evaluate trades ──
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

      const ctx = buildTradeContext(symbol, pred.prob, history, prevClose,
        profile?.shares_outstanding ?? 0, metadata.premarketVolume, metadata.gapPct);
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
      entry.trades.push({ time: md.time, prob: pred.prob, result: trade.result, pnl: trade.pnlPct });
    }
  }

  // ── Results ──
  const allEntries = [...symbolEntries.entries()];
  const withSignals = allEntries.filter(([, e]) => e.totalSignals > 0);
  const totalWins = withSignals.reduce((s, [, e]) => s + e.wins, 0);
  const totalLosses = withSignals.reduce((s, [, e]) => s + e.losses, 0);
  const totalNeutrals = withSignals.reduce((s, [, e]) => s + e.neutrals, 0);
  const totalSig = totalWins + totalLosses + totalNeutrals;
  const wr = totalSig > 0 ? (totalWins / (totalWins + totalLosses)) * 100 : 0;

  console.log(chalk.bgCyan.black.bold(`\n  RESULTS — ${date} (Wide Screener top ${WIDE_LIMIT})  \n`));
  console.log(chalk.white(`  Symbols: ${symbolEntries.size} total, ${withSignals.length} with signals`));
  console.log(chalk.white(`  Signals: ${totalSig} | `) +
    chalk.green(`${totalWins}W`) + chalk.dim(' / ') +
    chalk.red(`${totalLosses}L`) + chalk.dim(' / ') +
    chalk.yellow(`${totalNeutrals}N`) +
    chalk.dim(` | WR: `) + chalk.white.bold(`${wr.toFixed(1)}%`));

  const totalPnl = withSignals.reduce((s, [, e]) => s + e.totalPnl, 0);
  console.log(chalk.dim(`  Total PnL: `) + (totalPnl >= 0 ? chalk.green : chalk.red)(`${totalPnl.toFixed(2)}%`));

  // Sort by total_pnl descending
  withSignals.sort((a, b) => b[1].totalPnl - a[1].totalPnl);

  console.log(chalk.dim(`\n  ${'─'.repeat(110)}`));
  console.log(chalk.dim(`  ${'Symbol'.padEnd(8)} ${'Price'.padStart(7)} ${'Gap%'.padStart(6)} ${'Rank'.padStart(4)} ${'Seen'.padStart(5)} ${'Sig'.padStart(3)} ${'W'.padStart(2)} ${'L'.padStart(2)} ${'N'.padStart(2)} ${'WR%'.padStart(5)} ${'PnL'.padStart(7)} ${'Rankings'.padEnd(20)} Trades`));
  console.log(chalk.dim(`  ${'─'.repeat(110)}`));

  for (const [sym, e] of withSignals) {
    const wr = e.totalSignals > 0 ? (e.wins / (e.wins + e.losses || 1)) * 100 : 0;
    const pnlColor = e.totalPnl > 0 ? chalk.green : e.totalPnl < 0 ? chalk.red : chalk.dim;
    const wrColor = wr >= 50 ? chalk.green : chalk.red;
    const rankings = [...e.reasons].join(',');
    const time = minutesToTime(e.timeOfFirstEntryMin);
    const trades = e.trades.map(t => {
      const rc = t.result === 'win' ? chalk.green('W') : t.result === 'loss' ? chalk.red('L') : chalk.yellow('N');
      return `${t.time}(${rc})`;
    }).join(' ');

    console.log(
      `  ${chalk.white(sym.padEnd(8))} ` +
      `${chalk.dim(e.price.toFixed(2).padStart(7))} ` +
      `${chalk.dim(e.gapPct.toFixed(1).padStart(6))} ` +
      `${chalk.dim(String(e.combinedRank).padStart(4))} ` +
      `${chalk.dim(time.padStart(5))} ` +
      `${String(e.totalSignals).padStart(3)} ` +
      `${chalk.green(String(e.wins).padStart(2))} ` +
      `${chalk.red(String(e.losses).padStart(2))} ` +
      `${chalk.yellow(String(e.neutrals).padStart(2))} ` +
      `${wrColor(wr.toFixed(0).padStart(4))}% ` +
      `${pnlColor(e.totalPnl.toFixed(1).padStart(7))} ` +
      `${chalk.dim(rankings.padEnd(20))} ` +
      trades
    );
  }

  // Also show stocks WITHOUT signals (screener picked them but predict model didn't trigger)
  const noSignals = allEntries.filter(([, e]) => e.totalSignals === 0);
  console.log(chalk.dim(`\n  ${noSignals.length} stocks in wide screener WITHOUT signals (predict model didn't trigger)`));
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
