import * as dotenv from 'dotenv';
import path from 'path';

// Load .env from trading-agent root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import chalk from 'chalk';
import { timestampToET } from '../../collector/indicator.calculator';
import { AlpacaClient } from '../backtest-simulator/alpaca-client';
import { alpacaBarsToCandles } from '../backtest-simulator/candle-cache';
import { connectRedis, getCachedBars } from '../backtest-simulator/bars-cache';
import { createPool, getPrevCloseMap, getStockProfiles } from '../backtest-simulator/db';
import { IndicatorEngine } from '../backtest-simulator/indicator-engine';
import { PredictorClient } from '../backtest-simulator/predictor-client';
import { TradeSimulator } from '../backtest-simulator/trade-simulator';
import { DebugPredictLogger, type CandleSignal } from './logger';

// ── Args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const symbol = (args[0] || '').toUpperCase();
  if (!symbol) {
    console.error('Usage: ts-node main.ts SYMBOL DATE [fromTime] [toTime] [threshold] [tp] [sl]');
    console.error('Example: ts-node main.ts MDAI 2026-03-19 09:30 11:00 0.65 4 2');
    process.exit(1);
  }
  return {
    symbol,
    date: args[1] || todayNY(),
    fromTime: args[2] || '09:30',
    toTime: args[3] || '11:00',
    threshold: parseFloat(args[4]) || 0.65,
    targetPct: parseFloat(args[5]) || 4,
    stopLossPct: parseFloat(args[6]) || 2,
  };
}

function todayNY(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const config = parseArgs(process.argv);
  const { symbol, date, fromTime, toTime, threshold, targetPct, stopLossPct } = config;

  const logger = new DebugPredictLogger(threshold, targetPct, stopLossPct);
  logger.printHeader(symbol, date, fromTime, toTime);

  const indicatorEngine = new IndicatorEngine();
  const predictorClient = new PredictorClient();
  const tradeSimulator = new TradeSimulator(targetPct, stopLossPct, 120);

  const pool = createPool();
  let redis: Awaited<ReturnType<typeof connectRedis>> | null = null;

  try {
    // 1. Load prev_close and stock profile from DB
    console.log(chalk.dim('[Init] Loading prev_close and stock profiles...'));
    const [prevCloseMap, profiles] = await Promise.all([
      getPrevCloseMap(pool, date),
      getStockProfiles(pool),
    ]);

    const prevClose = prevCloseMap.get(symbol) ?? 0;
    const profile = profiles.get(symbol);
    console.log(
      chalk.dim('  prev_close: ') + chalk.white(prevClose > 0 ? prevClose.toFixed(2) : 'N/A') +
      chalk.dim(' | profile: ') + chalk.white(profile ? `shares=${profile.shares_outstanding}` : 'N/A'),
    );

    // 2. Fetch 1m bars (Redis cache or Alpaca)
    let bars: import('../../scanner/screener/alpaca/alpaca-screener.client').AlpacaBar[] | undefined;

    try {
      redis = await connectRedis();
      const cached = await getCachedBars(redis, date);
      if (cached) {
        const symbolBars = cached.get(symbol);
        if (symbolBars && symbolBars.length > 0) {
          bars = symbolBars;
          console.log(chalk.green(`[Redis] Cache hit: ${bars.length} bars for ${symbol}`));
        } else {
          console.log(chalk.yellow(`[Redis] Cache exists but no bars for ${symbol}, fetching from Alpaca...`));
        }
      } else {
        console.log(chalk.yellow(`[Redis] No cache for ${date}, fetching from Alpaca...`));
      }
    } catch {
      console.log(chalk.yellow('[Redis] Unavailable, fetching from Alpaca...'));
    }

    if (!bars) {
      const alpacaClient = new AlpacaClient();
      const barsMap = await alpacaClient.fetch1mBars([symbol], date);
      bars = barsMap.get(symbol) ?? [];
    }

    if (!bars.length) {
      console.error(chalk.red(`No bars found for ${symbol} on ${date}`));
      process.exit(1);
    }

    // 3. Convert to CollectorCandle[]
    const allCandles = alpacaBarsToCandles(bars);
    console.log(chalk.dim(`  Total candles: ${allCandles.length}\n`));

    // 4. Filter candles in the target time range and build payloads
    const fromMin = timeToMinutes(fromTime);
    const toMin = timeToMinutes(toTime);

    const targetIndices: number[] = [];
    for (let i = 0; i < allCandles.length; i++) {
      const { minuteOfDay } = timestampToET(allCandles[i].t);
      if (minuteOfDay >= fromMin && minuteOfDay <= toMin) {
        targetIndices.push(i);
      }
    }

    if (!targetIndices.length) {
      console.error(chalk.red(`No candles in ${fromTime}-${toTime} range`));
      process.exit(1);
    }

    console.log(chalk.dim(`[Predict] Building ${targetIndices.length} payloads...`));

    const payloads: import('../backtest-simulator/types').PredictPayload[] = [];
    for (const idx of targetIndices) {
      const history = allCandles.slice(0, idx + 1);
      if (history.length < 2) continue;

      const metadata = indicatorEngine.buildMetadata(history, prevClose, profile);
      const row = indicatorEngine.buildRow(symbol, history, metadata);
      const payload = indicatorEngine.buildPredictPayload(row, history);
      payloads.push(payload);
    }

    // 5. Batch predict
    console.log(chalk.dim(`[Predict] Calling predict_batch with ${payloads.length} payloads...`));
    const results = await predictorClient.predictBatch(payloads, threshold);

    // 6. Build signals for the logger
    const signals: CandleSignal[] = [];
    const tpDec = targetPct / 100;

    for (let i = 0; i < targetIndices.length; i++) {
      const idx = targetIndices[i];
      const candle = allCandles[idx];
      const { time } = timestampToET(candle.t);
      const pred = results[i] ?? { tradeable: false, prob: 0, threshold };

      // max_future_return_10m (look-ahead)
      const future10 = allCandles.slice(idx + 1, idx + 11);
      const entryPrice = candle.c;
      let mfr10m = 0;
      if (future10.length > 0 && entryPrice > 0) {
        const maxHigh = Math.max(...future10.map((c) => c.h));
        mfr10m = (maxHigh - entryPrice) / entryPrice;
      }

      // Trade evaluation (if tradeable)
      let trade: import('../backtest-simulator/types').TradeResult | undefined;
      if (pred.tradeable) {
        trade = tradeSimulator.evaluate(allCandles, idx);
      }

      signals.push({
        time,
        open: candle.o,
        high: candle.h,
        low: candle.l,
        close: candle.c,
        volume: candle.v,
        prob: pred.prob,
        tradeable: pred.tradeable,
        mfr10m,
        trade,
      });
    }

    // 7. Print results
    logger.printTable(signals);
  } finally {
    redis?.disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
