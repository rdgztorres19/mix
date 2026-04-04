#!/usr/bin/env npx ts-node
/**
 * main.ts — News-Reaction Trading Strategy (Live / Paper)
 *
 * Connects to Alpaca News WebSocket, classifies headlines in real-time,
 * and places bracket orders on Alpaca Paper Trading.
 *
 * Usage:
 *   npx ts-node src/scripts/news-trader/main.ts
 *   npx ts-node src/scripts/news-trader/main.ts --dry-run
 *   npx ts-node src/scripts/news-trader/main.ts --size 500 --max-positions 3
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { DEFAULT_CONFIG, parseArgs, isPremarket, isRegularHours, isForceCloseTime, nowET, type TradeConfig, type TradeSignal, type ActivePosition } from './config';
import { classifyHeadline } from './classifier';
import { AlpacaNewsTraderClient } from './alpaca-client';
import { PositionManager } from './position-manager';
import { TradeLogger } from './logger';

async function main() {
  const overrides = parseArgs(process.argv);
  const config: TradeConfig = { ...DEFAULT_CONFIG, ...overrides };

  console.log('═'.repeat(60));
  console.log('  NEWS-REACTION TRADER');
  console.log('═'.repeat(60));
  console.log(`  Mode:       ${config.dryRun ? 'DRY RUN (no orders)' : 'PAPER TRADING'}`);
  console.log(`  Position:   $${config.positionSizeDollars}`);
  console.log(`  Max pos:    ${config.maxPositions}`);
  console.log(`  Long TP/SL: ${config.longTpPct}% / ${config.longSlPct}%`);
  console.log(`  Short TP/SL: ${config.shortTpPct}% / ${config.shortSlPct}%`);
  console.log(`  Max hold:   ${config.maxHoldMinutes} min`);
  console.log(`  Hours:      ${config.premarketStartET} - ${config.forceCloseET} ET`);
  console.log(`  Time now:   ${nowET()} ET`);
  console.log('═'.repeat(60));

  const client = new AlpacaNewsTraderClient();
  const pm = new PositionManager();
  const logger = new TradeLogger();

  // Show account info
  if (!config.dryRun) {
    try {
      const account = await client.getAccount();
      console.log(`\n  Account: $${parseFloat(account.equity).toFixed(2)} equity, $${parseFloat(account.buying_power).toFixed(2)} buying power`);
    } catch (e) {
      console.error(`  Account error: ${(e as Error).message}`);
    }
  }

  // Track processed news IDs to avoid duplicates
  const processedNews = new Set<number>();

  // ── News Handler ──────────────────────────────────────────────────

  client.onNews(async (article) => {
    // Deduplicate
    if (processedNews.has(article.id)) return;
    processedNews.add(article.id);

    // Classify
    const classification = classifyHeadline(article.headline);

    if (classification.direction === 'skip') {
      // Only log if it has tradeable symbols
      if (article.symbols.length > 0) {
        logger.logSkip(article.headline, article.symbols, `${classification.category} → skip`);
      }
      return;
    }

    // Check news age
    const newsAge = (Date.now() - new Date(article.created_at).getTime()) / 60_000;
    if (newsAge > config.maxNewsAgeMinutes) {
      logger.logSkip(article.headline, article.symbols, `too old (${newsAge.toFixed(0)} min)`);
      return;
    }

    // Check trading hours
    const inPremarket = isPremarket(config);
    const inRegular = isRegularHours(config);
    if (!inPremarket && !inRegular) {
      logger.logSkip(article.headline, article.symbols, `outside trading hours (${nowET()} ET)`);
      return;
    }

    // Process each symbol in the article
    for (const symbol of article.symbols) {
      // Check position limit
      if (!pm.canEnter(symbol, config)) {
        continue;
      }

      // Get current price and check filters
      const snapshot = await client.getSnapshot(symbol);
      if (!snapshot) {
        logger.logSkip(article.headline, [symbol], 'no price data');
        continue;
      }

      if (snapshot.price < config.minPrice || snapshot.price > config.maxPrice) {
        logger.logSkip(article.headline, [symbol], `price $${snapshot.price.toFixed(2)} outside range`);
        continue;
      }

      // Determine TP/SL based on strength
      const isStrong = classification.strength === 'STRONG';
      const tpPct = classification.direction === 'long'
        ? (isStrong ? config.longTpPct : config.moderateTpPct)
        : (isStrong ? config.shortTpPct : config.moderateTpPct);
      const slPct = classification.direction === 'long'
        ? config.longSlPct
        : config.shortSlPct;

      const signal: TradeSignal = {
        symbol,
        direction: classification.direction,
        headline: article.headline,
        category: classification.category,
        strength: classification.strength as 'STRONG' | 'MODERATE',
        tpPct,
        slPct,
        timestamp: article.created_at,
        newsId: article.id,
      };

      logger.logSignal(signal);

      if (config.dryRun) {
        logger.logInfo(`[DRY RUN] Would place ${signal.direction} order for ${symbol} @ $${snapshot.price.toFixed(2)}`);
        continue;
      }

      // Place order
      try {
        const side = signal.direction === 'long' ? 'buy' : 'sell';
        let orderId: string;

        if (inPremarket) {
          // Extended hours: limit order, manual TP/SL
          const limitPrice = signal.direction === 'long'
            ? snapshot.price * 1.005  // 0.5% above for aggressive fill
            : snapshot.price * 0.995; // 0.5% below for shorts
          orderId = await client.placeExtendedHoursOrder({
            symbol,
            side,
            notional: config.positionSizeDollars,
            limitPrice,
          });
        } else {
          // Regular hours: bracket order with server-side TP/SL
          orderId = await client.placeBracketOrder({
            symbol,
            side,
            notional: config.positionSizeDollars,
            takeProfitPct: tpPct,
            stopLossPct: slPct,
            lastPrice: snapshot.price,
          });
        }

        const entryPrice = snapshot.price;
        const tpLevel = signal.direction === 'long'
          ? entryPrice * (1 + tpPct / 100)
          : entryPrice * (1 - tpPct / 100);
        const slLevel = signal.direction === 'long'
          ? entryPrice * (1 - slPct / 100)
          : entryPrice * (1 + slPct / 100);

        const position: ActivePosition = {
          symbol,
          direction: signal.direction,
          entryPrice,
          tpLevel,
          slLevel,
          orderId,
          enteredAt: new Date(),
          headline: article.headline,
          isPremarket: inPremarket,
        };

        pm.addPosition(position);
        logger.logEntry(signal, orderId, entryPrice, inPremarket);
      } catch (e) {
        console.error(`  ❌ Order failed for ${symbol}: ${(e as Error).message}`);
      }

      // Only trade the first matching symbol per article
      break;
    }
  });

  // ── Connect to News Stream ────────────────────────────────────────

  console.log('\n  Connecting to Alpaca News WebSocket...');
  try {
    await client.connectNewsStream();
    console.log('  ✅ News stream connected. Waiting for news...\n');
  } catch (e) {
    console.error(`  ❌ Failed to connect: ${(e as Error).message}`);
    process.exit(1);
  }

  // ── Position Monitor ──────────────────────────────────────────────

  const monitorInterval = setInterval(async () => {
    if (pm.size === 0) return;

    const interval = isPremarket(config)
      ? config.premarketPollIntervalMs
      : config.pollIntervalMs;

    await pm.checkPositions(client, config, (symbol, reason, pnlPct) => {
      logger.logExit(symbol, reason, pnlPct);
    });
  }, config.premarketPollIntervalMs); // use faster interval, checkPositions handles logic

  // ── Graceful Shutdown ─────────────────────────────────────────────

  const shutdown = async () => {
    console.log('\n  Shutting down...');
    clearInterval(monitorInterval);

    if (!config.dryRun && pm.size > 0) {
      console.log(`  Closing ${pm.size} positions...`);
      await pm.closeAllEndOfDay(client, (symbol, reason, pnlPct) => {
        logger.logExit(symbol, reason, pnlPct);
      });
    }

    client.disconnectNews();
    logger.printSummary();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  console.log('  Press Ctrl+C to stop.\n');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
