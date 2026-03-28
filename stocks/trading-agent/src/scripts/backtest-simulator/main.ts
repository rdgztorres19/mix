import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from trading-agent root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { parseArgs } from './config';
import { createPool, getUniverseSymbols, getStockProfiles } from './db';
import { AlpacaClient } from './alpaca-client';
import { CandleCache } from './candle-cache';
import { connectRedis, getCachedBars, setCachedBars } from './bars-cache';
import { hasLocalData, readLocalBars, readLocalPrevClose } from '../data-downloader/file-cache';
import { barsPrevCloseBeforeSession } from '../../scanner/screener/ranking/rankers/screener-rankers';
import { BacktestScreener } from './screener';
import { IndicatorEngine } from './indicator-engine';
import { PredictorClient } from './predictor-client';
import { TradeSimulator } from './trade-simulator';
import { SimLogger } from './logger';
import chalk from 'chalk';

const MARKET_OPEN_MINUTE = 9 * 60 + 30; // 09:30

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Convert a date string + HH:MM time in ET to unix ms.
 * Uses America/New_York timezone.
 */
function etToUnixMs(dateStr: string, timeStr: string): number {
  // Build an ISO-like string and parse in ET
  const [h, m] = timeStr.split(':').map(Number);
  // Create date in UTC, then adjust for ET offset
  const naive = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);

  // Use Intl to find the ET offset for this date
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  // Binary search for the correct ms that maps to the desired ET time
  // Simple approach: assume ET is UTC-4 or UTC-5
  const jan = new Date(`${dateStr.slice(0, 4)}-01-15T12:00:00Z`);
  const jul = new Date(`${dateStr.slice(0, 4)}-07-15T12:00:00Z`);
  const janOffset = getETOffset(jan);
  const targetDate = new Date(`${dateStr}T12:00:00Z`);
  const offset = getETOffset(targetDate);

  // ET time = UTC time + offset (offset is negative, e.g., -4 or -5)
  // So UTC = ET - offset => UTC = ET + |offset|
  const utcMs = Date.UTC(
    parseInt(dateStr.slice(0, 4)),
    parseInt(dateStr.slice(5, 7)) - 1,
    parseInt(dateStr.slice(8, 10)),
    h - offset,
    m,
    0,
  );
  return utcMs;
}

function getETOffset(date: Date): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
  const etStr = date.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const utcHour = parseInt(utcStr.split(',')[1].trim().split(':')[0]);
  const etHour = parseInt(etStr.split(',')[1].trim().split(':')[0]);
  let diff = etHour - utcHour;
  if (diff > 12) diff -= 24;
  if (diff < -12) diff += 24;
  return diff;
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

async function main() {
  const config = parseArgs(process.argv);
  console.log(chalk.bgBlue.white.bold('\n  Backtest Simulator  '));
  console.log(
    chalk.dim('  Date: ') + chalk.white.bold(config.date) +
    chalk.dim(' | Time: ') + chalk.white.bold(`${config.startTime}-${config.endTime}`) +
    chalk.dim(' | Thr: ') + chalk.yellow.bold(String(config.threshold)) +
    chalk.dim(' | TP: ') + chalk.green.bold(`${config.targetPct}%`) +
    chalk.dim(' | SL: ') + chalk.red.bold(`${config.stopLossPct}%`) + '\n',
  );

  // 1. Initialize services
  const pool = createPool();
  const alpacaClient = new AlpacaClient();
  const candleCache = new CandleCache();
  const screener = new BacktestScreener(40, 500_000);
  const indicatorEngine = new IndicatorEngine();
  const predictorClient = new PredictorClient();
  const tradeSimulator = new TradeSimulator(config.targetPct, config.stopLossPct, 120);
  const logger = new SimLogger();
  logger.setThreshold(config.threshold);
  let redis: Awaited<ReturnType<typeof connectRedis>> | null = null;

  try {
    // 2. Load universe + stock profiles from DB
    console.log('[Init] Loading universe from screener_assets...');
    const universe = await getUniverseSymbols(pool);
    console.log(`  Universe: ${universe.length} symbols`);

    console.log('[Init] Loading stock profiles...');
    const profiles = await getStockProfiles(pool);
    console.log(`  Stock profiles: ${profiles.size}`);

    // 3. Load 1m bars + prev_close (local data → Redis → Alpaca)
    let allBars: Map<string, import('../../scanner/screener/alpaca/alpaca-screener.client').AlpacaBar[]>;
    let prevCloseMap: Map<string, number>;

    if (await hasLocalData(config.date)) {
      // Priority 1: Local compressed files
      console.log(chalk.green(`[Data] Loading from local file data/${config.date}/...`));
      allBars = await readLocalBars(config.date);
      prevCloseMap = await readLocalPrevClose(config.date);
      console.log(chalk.green(`  Local: ${allBars.size} symbols, ${prevCloseMap.size} prev_close entries`));
    } else {
      // Priority 2/3: Redis → Alpaca for 1m bars
      try {
        redis = await connectRedis();
        console.log(chalk.green('[Redis] Connected'));
        const cached = await getCachedBars(redis, config.date);
        if (cached) {
          allBars = cached;
          console.log(chalk.green(`[Redis] Cache hit for ${config.date}: ${allBars.size} symbols`));
        } else {
          console.log(chalk.yellow(`[Redis] Cache miss for ${config.date}, fetching from Alpaca...`));
          allBars = await alpacaClient.fetchUniverse1mBars(universe, config.date);
          await setCachedBars(redis, config.date, allBars);
          console.log(chalk.green(`[Redis] Cached ${allBars.size} symbols for ${config.date}`));
        }
      } catch (err) {
        console.warn(chalk.yellow(`[Redis] Unavailable (${(err as Error).message}), fetching from Alpaca...`));
        allBars = await alpacaClient.fetchUniverse1mBars(universe, config.date);
      }

      // prev_close: always from Alpaca daily bars
      console.log(chalk.cyan('[Init] Fetching daily bars for prev_close from Alpaca...'));
      const rangeStart = addDays(config.date, -10);
      const dailyBars = await alpacaClient.fetchDailyBarsRange(universe, rangeStart, config.date);
      prevCloseMap = new Map<string, number>();
      dailyBars.forEach((bars, sym) => {
        const pc = barsPrevCloseBeforeSession(bars, config.date);
        if (pc != null) prevCloseMap.set(sym, pc);
      });
      console.log(chalk.green(`  prev_close: ${prevCloseMap.size} entries (from Alpaca)`));
    }

    // 4. Load all bars into candle cache
    candleCache.loadFromBars(allBars);
    console.log(chalk.green(`  Cache loaded: ${candleCache.symbolCount} symbols with 1m data\n`));

    // 5. Run minute-by-minute simulation
    const startMin = timeToMinutes(config.startTime);
    const endMin = timeToMinutes(config.endTime);

    console.log(chalk.cyan(`[Sim] Starting simulation from ${config.startTime} to ${config.endTime}...`));

    for (let min = startMin; min <= endMin; min++) {
      const currentTime = minutesToTime(min);
      const currentTimeMs = etToUnixMs(config.date, currentTime);
      const isAfterOpen = min > MARKET_OPEN_MINUTE;

      // 5a. Build synthetic snapshots from ALL cached 1m bars up to current minute
      const allCandlesUpTo = candleCache.getAllSymbolCandles(currentTimeMs);
      const synthSnapshots = screener.buildSyntheticSnapshots(allCandlesUpTo, prevCloseMap);

      // 5b. Compute combined list + reasons
      const { symbols: combinedList, reasons } = screener.computeCombinedList(
        synthSnapshots,
        config.date,
        prevCloseMap,
        isAfterOpen,
      );

      // 5c. Feed snapshot data to logger for summary table
      logger.updateMarketData(synthSnapshots, combinedList);

      // 5d. Build indicators + predict payloads for each symbol
      const payloads: { symbol: string; payload: import('./types').PredictPayload }[] = [];

      for (const symbol of combinedList) {
        const history = candleCache.getCandlesUpTo(symbol, currentTimeMs);
        if (history.length < 2) continue;

        const prevClose = prevCloseMap.get(symbol) ?? 0;
        if (prevClose <= 0) continue;

        const metadata = indicatorEngine.buildMetadata(history, prevClose, profiles.get(symbol));
        const row = indicatorEngine.buildRow(symbol, history, metadata);
        const payload = indicatorEngine.buildPredictPayload(row, history);
        payloads.push({ symbol, payload });
      }

      // 5e. Batch predict
      let predictions: import('./types').PredictResult[] = [];
      if (payloads.length > 0) {
        try {
          predictions = await predictorClient.predictBatch(
            payloads.map((p) => p.payload),
            config.threshold,
          );
        } catch (err) {
          console.error(`  [Predict] Error at ${currentTime}:`, (err as Error).message);
          predictions = payloads.map(() => ({ tradeable: false, prob: 0, threshold: config.threshold }));
        }
      }

      // 5f. Evaluate trades for BUY signals
      const minuteSignals: { symbol: string; prob: number; tradeable: boolean; trade?: import('./types').TradeResult }[] = [];

      for (let i = 0; i < payloads.length; i++) {
        const { symbol } = payloads[i];
        const pred = predictions[i] ?? { tradeable: false, prob: 0, threshold: config.threshold };

        if (pred.tradeable) {
          // Find entry candle index in full day bars
          const allCandles = candleCache.getAllCandles(symbol);
          const history = candleCache.getCandlesUpTo(symbol, currentTimeMs);
          const entryIdx = history.length - 1;

          // Look-ahead evaluation
          const trade = tradeSimulator.evaluate(allCandles, entryIdx);
          minuteSignals.push({ symbol, prob: pred.prob, tradeable: true, trade });
        } else {
          minuteSignals.push({ symbol, prob: pred.prob, tradeable: false });
        }
      }

      // 5g. Log minute results
      logger.logMinute(currentTime, combinedList, reasons, minuteSignals);
    }

    // 6. Final summary
    logger.printSummary(config);
  } finally {
    redis?.disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
