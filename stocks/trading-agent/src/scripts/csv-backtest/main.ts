import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import chalk from 'chalk';
import * as fs from 'fs';
import * as readline from 'readline';
import { parseArgs } from '../backtest-simulator/config';
import { PredictorClient } from '../backtest-simulator/predictor-client';
import { TradeSimulator } from '../backtest-simulator/trade-simulator';
import { SimLogger } from '../backtest-simulator/logger';
import type { CollectorCandle } from '../../collector/indicator.calculator';
import type { TradeResult, PredictPayload } from '../backtest-simulator/types';

// ── Config ───────────────────────────────────────────────────────────────────

const CSV_PATH = path.resolve(__dirname, '../../../../stock-training/data/training-v2.csv');

const CSV_COLUMNS = [
  'symbol', 'date', 'candle_time_et', 'candle_idx',
  'open', 'high', 'low', 'close', 'volume',
  'atr', 'vwap', 'high_of_day', 'low_of_day',
  'change_pct_at_candle', 'ema9', 'ema20',
  'pre_market_high', 'session',
  'shares_outstanding', 'market_cap', 'gap_pct', 'premarket_volume',
  'momentum_acumulado', 'change_1m', 'change_5m', 'change_10m',
  'minutes_since_hod',
  'future_return_5m', 'target', 'target_break_hod_5m', 'max_future_return_10m',
];

function num(v: string | undefined): number {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface CsvRow { [key: string]: string; }

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ── CSV Loading (streaming) ──────────────────────────────────────────────────

async function loadCsvByDate(csvPath: string, date: string): Promise<Map<string, CsvRow[]>> {
  const bySymbol = new Map<string, CsvRow[]>();

  if (!fs.existsSync(csvPath)) {
    console.error(chalk.red(`CSV not found: ${csvPath}`));
    process.exit(1);
  }

  console.log(chalk.dim(`[CSV] Streaming ${csvPath} for date ${date}...`));

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  let rowCount = 0;

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    if (lineNum === 0) {
      lineNum++;
      if (line.toLowerCase().startsWith('symbol')) continue;
    }
    lineNum++;

    if (!line.includes(date)) continue;

    const vals = line.split(',');
    if (vals.length < 20) continue;

    const row: CsvRow = {};
    for (let j = 0; j < CSV_COLUMNS.length && j < vals.length; j++) {
      row[CSV_COLUMNS[j]] = vals[j];
    }

    if (row.date !== date) continue;

    const sym = row.symbol;
    let arr = bySymbol.get(sym);
    if (!arr) { arr = []; bySymbol.set(sym, arr); }
    arr.push(row);
    rowCount++;
  }

  console.log(chalk.dim(`  Loaded ${rowCount} rows for ${bySymbol.size} symbols\n`));
  return bySymbol;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs(process.argv);

  const symbolIdx = process.argv.indexOf('--symbol');
  const symbolFilter = symbolIdx >= 0 ? (process.argv[symbolIdx + 1] || '').toUpperCase() : null;

  console.log(chalk.bgMagenta.white.bold('\n  CSV Backtest (training-v2)  '));
  console.log(
    chalk.dim('  Date: ') + chalk.white.bold(config.date) +
    chalk.dim(' | Time: ') + chalk.white.bold(`${config.startTime}-${config.endTime}`) +
    chalk.dim(' | Thr: ') + chalk.yellow.bold(String(config.threshold)) +
    chalk.dim(' | TP: ') + chalk.green.bold(`${config.targetPct}%`) +
    chalk.dim(' | SL: ') + chalk.red.bold(`${config.stopLossPct}%`) +
    (symbolFilter ? chalk.dim(' | Symbol: ') + chalk.yellow.bold(symbolFilter) : '') + '\n',
  );

  const predictorClient = new PredictorClient();
  const tradeSimulator = new TradeSimulator(config.targetPct, config.stopLossPct, 120);
  const logger = new SimLogger();
  logger.setThreshold(config.threshold);

  const bySymbol = await loadCsvByDate(CSV_PATH, config.date);
  if (bySymbol.size === 0) {
    console.error(chalk.red(`No data for ${config.date} in CSV`));
    process.exit(1);
  }

  if (symbolFilter) {
    const filtered = bySymbol.get(symbolFilter);
    if (!filtered) {
      console.error(chalk.red(`Symbol ${symbolFilter} not found in CSV for ${config.date}`));
      process.exit(1);
    }
    bySymbol.clear();
    bySymbol.set(symbolFilter, filtered);
    console.log(chalk.dim(`  Filtered to symbol: ${symbolFilter}\n`));
  }

  // Build candles for TP/SL evaluation (just need OHLCV array per symbol)
  const candlesMap = new Map<string, CollectorCandle[]>();
  bySymbol.forEach((rows, sym) => {
    candlesMap.set(sym, rows.map((r, i) => ({
      o: num(r.open), h: num(r.high), l: num(r.low), c: num(r.close), v: num(r.volume), t: i,
    })));
  });

  const startMin = timeToMinutes(config.startTime);
  const endMin = timeToMinutes(config.endTime);

  console.log(chalk.cyan(`[Sim] Running CSV backtest from ${config.startTime} to ${config.endTime}...`));

  // Iterate by actual candle times, not by clock minutes
  // Collect all unique candle times across all symbols in the window
  const allTimes = new Set<string>();
  bySymbol.forEach((rows) => {
    for (const r of rows) {
      const min = timeToMinutes(r.candle_time_et || '00:00');
      if (min >= startMin && min <= endMin) {
        allTimes.add(r.candle_time_et);
      }
    }
  });
  const sortedTimes = [...allTimes].sort();

  for (const currentTime of sortedTimes) {
    // Collect symbols that have a candle at this exact time
    const combinedList: string[] = [];
    const reasons = new Map<string, Set<string>>();

    bySymbol.forEach((rows, sym) => {
      if (rows.some(r => r.candle_time_et === currentTime)) {
        combinedList.push(sym);
        reasons.set(sym, new Set(['CSV']));
      }
    });

    // Build payloads — send raw candles to Python (NO TypeScript computeCandleRow)
    const payloads: { symbol: string; payload: PredictPayload; candleIdx: number }[] = [];

    for (const symbol of combinedList) {
      const rows = bySymbol.get(symbol)!;

      // Find the target candle index
      const targetRowIdx = rows.findIndex(r => r.candle_time_et === currentTime);
      if (targetRowIdx < 1) continue;

      const targetRow = rows[targetRowIdx];

      // Build candle history up to this point (raw from CSV)
      const history = rows.slice(0, targetRowIdx + 1);
      const candles = history.map((r, i) => ({
        t: i,
        o: num(r.open),
        h: num(r.high),
        l: num(r.low),
        c: num(r.close),
        v: num(r.volume),
      }));

      // Send CSV values as metadata (Python will recompute features from candles)
      const payload: PredictPayload = {
        candles,
        target_idx: candles.length - 1,
        candle_times_et: history.map(r => r.candle_time_et || '09:30'),
        candle_idx_arr: history.map((_, i) => i),
        atr: num(targetRow.atr),
        high_of_day: num(targetRow.high_of_day),
        low_of_day: num(targetRow.low_of_day),
        pre_market_high: num(targetRow.pre_market_high),
        change_pct_at_candle: num(targetRow.change_pct_at_candle),
        shares_outstanding: num(targetRow.shares_outstanding),
        market_cap: num(targetRow.market_cap),
        gap_pct: num(targetRow.gap_pct),
        premarket_volume: num(targetRow.premarket_volume),
      };

      payloads.push({ symbol, payload, candleIdx: targetRowIdx });
    }

    // Batch predict
    let predictions: { tradeable: boolean; prob: number; threshold: number }[] = [];
    if (payloads.length > 0) {
      try {
        predictions = await predictorClient.predictBatch(
          payloads.map(p => p.payload),
          config.threshold,
        );
      } catch (err) {
        console.error(`  [Predict] Error at ${currentTime}:`, (err as Error).message);
        predictions = payloads.map(() => ({ tradeable: false, prob: 0, threshold: config.threshold }));
      }
    }

    // Evaluate trades
    const minuteSignals: { symbol: string; prob: number; tradeable: boolean; trade?: TradeResult }[] = [];

    for (let i = 0; i < payloads.length; i++) {
      const { symbol, candleIdx } = payloads[i];
      const pred = predictions[i] ?? { tradeable: false, prob: 0, threshold: config.threshold };

      if (pred.tradeable) {
        const allCandles = candlesMap.get(symbol)!;
        const trade = tradeSimulator.evaluate(allCandles, candleIdx);
        minuteSignals.push({ symbol, prob: pred.prob, tradeable: true, trade });
      } else {
        minuteSignals.push({ symbol, prob: pred.prob, tradeable: false });
      }
    }

    logger.logMinute(currentTime, combinedList, reasons as any, minuteSignals);
  }

  logger.printSummary(config);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
