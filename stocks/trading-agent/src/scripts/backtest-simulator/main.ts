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
import { applyFilters, buildTradeContext, FILTERS } from './trade-filters';
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

    // Connect Redis (used for screener cache + bars cache)
    try {
      redis = await connectRedis();
      console.log(chalk.green('[Redis] Connected'));
    } catch {
      console.log(chalk.yellow('[Redis] Unavailable — screener cache disabled'));
    }

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
        if (!redis) throw new Error('Redis not available');
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

    const everSeenSymbols = new Set<string>();
    const lastCandleCount = new Map<string, number>();
    const signalsPerStock = new Map<string, number>();

    // Log active filters
    const activeFilters = Object.entries(FILTERS).filter(([, f]) => f.enabled).map(([, f]) => f.name);
    console.log(chalk.dim(`  Filters: ${activeFilters.length > 0 ? activeFilters.join(', ') : 'none'}`));
    console.log(chalk.dim(`  Max signals per stock: 3\n`));

    // ═══ PHASE 1: Run screener + build payloads (with Redis cache) ═══
    console.log(chalk.cyan('  [Phase 1] Running screener for all minutes...'));
    const t0Phase1 = Date.now();

    interface MinuteData {
      min: number;
      time: string;
      timeMs: number;
      symbolsToPredict: string[];
      reasons: Map<string, Set<import('../../scanner/screener/persistence/screener.repository').ScreenerRankType>>;
      payloads: { symbol: string; payload: import('./types').PredictPayload }[];
    }

    const minuteDataList: MinuteData[] = [];

    // Try to load screener results from Redis cache
    const screenerCacheKey = `backtest:screener:${config.date}:${config.startTime}:${config.endTime}`;
    type ScreenerCache = { symbolsPerMinute: Record<string, string[]> };
    let screenerCache: ScreenerCache | null = null;

    if (redis) {
      try {
        const cached = await redis.get(screenerCacheKey);
        if (cached) {
          screenerCache = JSON.parse(cached) as ScreenerCache;
          console.log(chalk.green(`  [Redis] Screener cache hit (${Object.keys(screenerCache.symbolsPerMinute).length} minutes)`));
        }
      } catch { /* ignore */ }
    }

    if (screenerCache) {
      // Rebuild from cache: we know which symbols to predict per minute
      for (let min = startMin; min <= endMin; min++) {
        const currentTime = minutesToTime(min);
        const currentTimeMs = etToUnixMs(config.date, currentTime);

        const cachedSymbols = screenerCache.symbolsPerMinute[currentTime] ?? [];
        for (const sym of cachedSymbols) everSeenSymbols.add(sym);
        const symbolsToPredict = [...everSeenSymbols];

        // Build payloads
        const payloads: { symbol: string; payload: import('./types').PredictPayload }[] = [];
        for (const symbol of symbolsToPredict) {
          const history = candleCache.getCandlesUpTo(symbol, currentTimeMs);
          if (history.length < 2) continue;
          const prevCount = lastCandleCount.get(symbol) ?? 0;
          if (history.length === prevCount) continue;
          lastCandleCount.set(symbol, history.length);
          const prevClose = prevCloseMap.get(symbol) ?? 0;
          if (prevClose <= 0) continue;
          const metadata = indicatorEngine.buildMetadata(history, prevClose, profiles.get(symbol));
          const row = indicatorEngine.buildRow(symbol, history, metadata);
          const payload = indicatorEngine.buildPredictPayload(row, history);
          payloads.push({ symbol, payload });
        }

        const reasons = new Map<string, Set<import('../../scanner/screener/persistence/screener.repository').ScreenerRankType>>();
        minuteDataList.push({ min, time: currentTime, timeMs: currentTimeMs, symbolsToPredict, reasons, payloads });
      }
    } else {
      // Run screener from scratch
      const screenerResults: Record<string, string[]> = {};

      for (let min = startMin; min <= endMin; min++) {
        const currentTime = minutesToTime(min);
        const currentTimeMs = etToUnixMs(config.date, currentTime);
        const isAfterOpen = min > MARKET_OPEN_MINUTE;

        const allCandlesUpTo = candleCache.getAllSymbolCandles(currentTimeMs);
        const synthSnapshots = screener.buildSyntheticSnapshots(allCandlesUpTo, prevCloseMap);

        const { symbols: combinedList, reasons } = screener.computeCombinedList(
          synthSnapshots, config.date, prevCloseMap, isAfterOpen,
        );

        screenerResults[currentTime] = combinedList;
        for (const sym of combinedList) everSeenSymbols.add(sym);
        const symbolsToPredict = [...everSeenSymbols];

        logger.updateMarketData(synthSnapshots, symbolsToPredict);

        const payloads: { symbol: string; payload: import('./types').PredictPayload }[] = [];
        for (const symbol of symbolsToPredict) {
          const history = candleCache.getCandlesUpTo(symbol, currentTimeMs);
          if (history.length < 2) continue;
          const prevCount = lastCandleCount.get(symbol) ?? 0;
          if (history.length === prevCount) continue;
          lastCandleCount.set(symbol, history.length);
          const prevClose = prevCloseMap.get(symbol) ?? 0;
          if (prevClose <= 0) continue;
          const metadata = indicatorEngine.buildMetadata(history, prevClose, profiles.get(symbol));
          const row = indicatorEngine.buildRow(symbol, history, metadata);
          const payload = indicatorEngine.buildPredictPayload(row, history);
          payloads.push({ symbol, payload });
        }

        minuteDataList.push({ min, time: currentTime, timeMs: currentTimeMs, symbolsToPredict, reasons, payloads });
      }

      // Save screener results to Redis (TTL 1 day)
      if (redis) {
        try {
          const cacheData: ScreenerCache = { symbolsPerMinute: screenerResults };
          await redis.setex(screenerCacheKey, 86_400, JSON.stringify(cacheData));
          console.log(chalk.green('  [Redis] Screener results cached'));
        } catch { /* ignore */ }
      }
    }

    console.log(chalk.green(`  Phase 1 done: ${minuteDataList.length} minutes, ${minuteDataList.reduce((s, m) => s + m.payloads.length, 0)} total payloads (${((Date.now() - t0Phase1) / 1000).toFixed(1)}s)`));

    // ═══ PHASE 2: Predict in parallel (batch multiple minutes) ═══
    console.log(chalk.cyan('  [Phase 2] Running predictions in parallel...'));
    const t0Phase2 = Date.now();

    const PARALLEL_MINUTES = 5; // spawn this many Python processes at once
    const minuteResults: { idx: number; predictions: import('./types').PredictResult[] }[] = [];

    for (let batch = 0; batch < minuteDataList.length; batch += PARALLEL_MINUTES) {
      const chunk = minuteDataList.slice(batch, batch + PARALLEL_MINUTES);

      const promises = chunk.map(async (md, chunkIdx) => {
        let predictions: import('./types').PredictResult[] = [];
        if (md.payloads.length > 0) {
          try {
            predictions = await predictorClient.predictBatch(
              md.payloads.map((p) => p.payload),
              config.threshold,
            );
          } catch (err) {
            console.error(`  [Predict] Error at ${md.time}:`, (err as Error).message);
            predictions = md.payloads.map(() => ({ tradeable: false, prob: 0, threshold: config.threshold }));
          }
        }
        return { idx: batch + chunkIdx, predictions };
      });

      const results = await Promise.all(promises);
      minuteResults.push(...results);
    }

    // Sort by minute index
    minuteResults.sort((a, b) => a.idx - b.idx);

    console.log(chalk.green(`  Phase 2 done (${((Date.now() - t0Phase2) / 1000).toFixed(1)}s)`));

    // ═══ PHASE 3: Evaluate trades + log (sequential, fast) ═══
    console.log(chalk.cyan('  [Phase 3] Evaluating trades + logging...\n'));

    for (let i = 0; i < minuteDataList.length; i++) {
      const md = minuteDataList[i];
      const predictions = minuteResults[i]?.predictions ?? [];

      const minuteSignals: { symbol: string; prob: number; tradeable: boolean; trade?: import('./types').TradeResult }[] = [];

      for (let j = 0; j < md.payloads.length; j++) {
        const { symbol } = md.payloads[j];
        const pred = predictions[j] ?? { tradeable: false, prob: 0, threshold: config.threshold };

        if (pred.tradeable) {
          const history = candleCache.getCandlesUpTo(symbol, md.timeMs);
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

          if (!pass) {
            minuteSignals.push({ symbol, prob: pred.prob, tradeable: false });
            continue;
          }

          const symSignalCount = signalsPerStock.get(symbol) ?? 0;
          if (symSignalCount >= 3) {
            minuteSignals.push({ symbol, prob: pred.prob, tradeable: false });
            continue;
          }
          signalsPerStock.set(symbol, symSignalCount + 1);

          const allCandles = candleCache.getAllCandles(symbol);
          const entryIdx = history.length - 1;
          const trade = tradeSimulator.evaluate(allCandles, entryIdx);
          minuteSignals.push({ symbol, prob: pred.prob, tradeable: true, trade });
        } else {
          minuteSignals.push({ symbol, prob: pred.prob, tradeable: false });
        }
      }

      logger.logMinute(md.time, md.symbolsToPredict, md.reasons, minuteSignals);
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
