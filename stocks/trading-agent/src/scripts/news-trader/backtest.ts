#!/usr/bin/env npx ts-node
/**
 * backtest.ts — Historical backtest for news-reaction strategy.
 *
 * Loads news.json.gz + bars-1m.json.gz from trading-agent/data/{date}/
 * and simulates the strategy on historical data.
 *
 * Usage:
 *   npx ts-node src/scripts/news-trader/backtest.ts 2026-03-20 2026-03-27
 *   npx ts-node src/scripts/news-trader/backtest.ts 2026-03-25 2026-03-25 --tp 6 --sl 2
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { DEFAULT_CONFIG, parseArgs, parseTimeMinutes, type TradeConfig } from './config';
import { classifyHeadline } from './classifier';

const DATA_DIR = path.resolve(__dirname, '../../../data');

interface HistoricalBar {
  t: string;  // ISO timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface HistoricalNews {
  id: number;
  headline: string;
  created_at: string;
  symbols: string[];
  source: string;
  summary: string;
}

function loadNewsForDate(dateStr: string): HistoricalNews[] {
  const newsPath = path.join(DATA_DIR, dateStr, 'news.json.gz');
  if (!fs.existsSync(newsPath)) return [];
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(newsPath)).toString('utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function loadBarsForDate(dateStr: string): Record<string, HistoricalBar[]> {
  const barsPath = path.join(DATA_DIR, dateStr, 'bars-1m.json.gz');
  if (!fs.existsSync(barsPath)) return {};
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(barsPath)).toString('utf-8');
    const data = JSON.parse(raw);
    if (typeof data === 'object' && !Array.isArray(data)) return data;
    return {};
  } catch {
    return {};
  }
}

function loadPrevClose(dateStr: string): Record<string, number> {
  const pcPath = path.join(DATA_DIR, dateStr, 'prev-close.json.gz');
  if (!fs.existsSync(pcPath)) return {};
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(pcPath)).toString('utf-8');
    const data = JSON.parse(raw);
    if (typeof data === 'object' && !Array.isArray(data)) return data;
    return {};
  } catch {
    return {};
  }
}

function computeGapPct(bars: HistoricalBar[], prevClose: number): number {
  if (!bars.length || prevClose <= 0) return 0;
  const firstOpen = bars[0].o;
  return ((firstOpen - prevClose) / prevClose) * 100;
}

function computeDayVolume(bars: HistoricalBar[]): number {
  return bars.reduce((sum, b) => sum + b.v, 0);
}

function barTimeToET(isoTime: string): number {
  const d = new Date(isoTime);
  const etStr = d.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return parseTimeMinutes(etStr);
}

function simulateTrade(
  bars: HistoricalBar[],
  entryIdx: number,
  direction: 'long' | 'short',
  tpPct: number,
  slPct: number,
  lookAhead: number,
): { result: 'win' | 'loss' | 'neutral'; pnlPct: number; exitBar: number } {
  const entryPrice = bars[entryIdx].c;
  if (entryPrice <= 0) return { result: 'neutral', pnlPct: 0, exitBar: 0 };

  const tpLevel = direction === 'long'
    ? entryPrice * (1 + tpPct / 100)
    : entryPrice * (1 - tpPct / 100);
  const slLevel = direction === 'long'
    ? entryPrice * (1 - slPct / 100)
    : entryPrice * (1 + slPct / 100);

  for (let j = 1; j <= Math.min(lookAhead, bars.length - entryIdx - 1); j++) {
    const bar = bars[entryIdx + j];

    if (direction === 'long') {
      const touchTp = bar.h >= tpLevel;
      const touchSl = bar.l <= slLevel;
      if (touchTp && touchSl) {
        return bar.c >= bar.o
          ? { result: 'loss', pnlPct: -slPct, exitBar: j }
          : { result: 'win', pnlPct: tpPct, exitBar: j };
      }
      if (touchTp) return { result: 'win', pnlPct: tpPct, exitBar: j };
      if (touchSl) return { result: 'loss', pnlPct: -slPct, exitBar: j };
    } else {
      const touchTp = bar.l <= tpLevel;
      const touchSl = bar.h >= slLevel;
      if (touchTp && touchSl) {
        return bar.c <= bar.o
          ? { result: 'win', pnlPct: tpPct, exitBar: j }
          : { result: 'loss', pnlPct: -slPct, exitBar: j };
      }
      if (touchTp) return { result: 'win', pnlPct: tpPct, exitBar: j };
      if (touchSl) return { result: 'loss', pnlPct: -slPct, exitBar: j };
    }
  }

  return { result: 'neutral', pnlPct: 0, exitBar: lookAhead };
}

function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const overrides = parseArgs(process.argv);
  const config: TradeConfig = { ...DEFAULT_CONFIG, ...overrides };

  const startDate = args[0] || '2026-03-20';
  const endDate = args[1] || args[0] || '2026-03-27';

  console.log('═'.repeat(60));
  console.log('  NEWS-REACTION BACKTEST');
  console.log('═'.repeat(60));
  console.log(`  Dates: ${startDate} → ${endDate}`);
  console.log(`  Long TP/SL: ${config.longTpPct}% / ${config.longSlPct}%`);
  console.log(`  Short TP/SL: ${config.shortTpPct}% / ${config.shortSlPct}%`);
  console.log(`  Look-ahead: 60 candles (1 hour)`);
  console.log('═'.repeat(60));

  // Get all dates
  const allDates = fs.readdirSync(DATA_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter(d => d >= startDate && d <= endDate)
    .sort();

  let totalSignals = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let totalNeutrals = 0;
  let totalPnl = 0;
  let longSignals = 0;
  let longWins = 0;
  let shortSignals = 0;
  let shortWins = 0;

  for (const dateStr of allDates) {
    const news = loadNewsForDate(dateStr);
    const allBars = loadBarsForDate(dateStr);
    const prevCloses = loadPrevClose(dateStr);

    if (news.length === 0 || Object.keys(allBars).length === 0) continue;

    let daySignals = 0;
    let dayWins = 0;
    let dayLosses = 0;
    let dayNeutrals = 0;
    let dayPnl = 0;
    const tradedSymbols = new Set<string>();

    // Sort news by time
    const sortedNews = [...news].sort((a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    for (const article of sortedNews) {
      const classification = classifyHeadline(article.headline);
      if (classification.direction === 'skip') continue;

      const newsTimeMin = barTimeToET(article.created_at);

      // Only trade during premarket + regular hours
      const premarketStart = parseTimeMinutes(config.premarketStartET);
      const marketClose = parseTimeMinutes(config.marketCloseET);
      if (newsTimeMin < premarketStart || newsTimeMin > marketClose) continue;

      for (const symbol of article.symbols) {
        if (tradedSymbols.has(symbol)) continue; // max 1 trade per symbol per day

        const bars = allBars[symbol];
        if (!bars || bars.length < 30) continue;

        // Filter: minimum volume (skip low-liquidity stocks)
        const dayVol = computeDayVolume(bars);
        if (dayVol < 500_000) continue;

        // Filter: gap >= 5% (momentum stock) OR strong catalyst
        const prevClose = prevCloses[symbol] ?? 0;
        const gapPct = computeGapPct(bars, prevClose);
        const isGapper = Math.abs(gapPct) >= 5;
        const isStrongCatalyst = classification.strength === 'STRONG';
        if (!isGapper && !isStrongCatalyst) continue;

        // Find the bar closest to (and after) the news time
        let entryIdx = -1;
        for (let i = 0; i < bars.length; i++) {
          const barMin = barTimeToET(bars[i].t);
          if (barMin >= newsTimeMin) {
            entryIdx = i + 1; // enter NEXT bar after news
            break;
          }
        }

        if (entryIdx < 0 || entryIdx >= bars.length - 10) continue;

        const entryPrice = bars[entryIdx].c;
        if (entryPrice < config.minPrice || entryPrice > config.maxPrice) continue;

        // Determine TP/SL
        const isStrong = classification.strength === 'STRONG';
        const tpPct = classification.direction === 'long'
          ? (isStrong ? config.longTpPct : config.moderateTpPct)
          : (isStrong ? config.shortTpPct : config.moderateTpPct);
        const slPct = classification.direction === 'long'
          ? config.longSlPct
          : config.shortSlPct;

        const { result, pnlPct } = simulateTrade(
          bars, entryIdx, classification.direction, tpPct, slPct, 60,
        );

        tradedSymbols.add(symbol);
        daySignals++;
        dayPnl += pnlPct;

        if (classification.direction === 'long') {
          longSignals++;
          if (result === 'win') longWins++;
        } else {
          shortSignals++;
          if (result === 'win') shortWins++;
        }

        if (result === 'win') dayWins++;
        else if (result === 'loss') dayLosses++;
        else dayNeutrals++;

        // Only first symbol per article
        break;
      }
    }

    totalSignals += daySignals;
    totalWins += dayWins;
    totalLosses += dayLosses;
    totalNeutrals += dayNeutrals;
    totalPnl += dayPnl;

    if (daySignals > 0) {
      const wr = dayWins / Math.max(dayWins + dayLosses, 1) * 100;
      const avgPnl = dayPnl / daySignals;
      const marker = avgPnl > 0 ? '✓' : '✗';
      console.log(
        `  ${dateStr}: ${marker} sig=${daySignals.toString().padStart(3)} ` +
        `W=${dayWins.toString().padStart(2)} L=${dayLosses.toString().padStart(2)} ` +
        `N=${dayNeutrals.toString().padStart(2)} WR=${wr.toFixed(1).padStart(5)}% ` +
        `PnL=${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2)}%`
      );
    } else {
      console.log(`  ${dateStr}: no signals`);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  TOTAL');
  console.log('═'.repeat(60));

  if (totalSignals > 0) {
    const wr = totalWins / Math.max(totalWins + totalLosses, 1) * 100;
    const avgPnl = totalPnl / totalSignals;
    console.log(`  Signals: ${totalSignals} | W=${totalWins} L=${totalLosses} N=${totalNeutrals}`);
    console.log(`  Win Rate: ${wr.toFixed(1)}%`);
    console.log(`  Avg PnL: ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(3)}%`);
    console.log(`  Total PnL: ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%`);

    const longWr = longSignals > 0 ? (longWins / longSignals * 100) : 0;
    const shortWr = shortSignals > 0 ? (shortWins / shortSignals * 100) : 0;
    console.log(`\n  Long:  ${longSignals} signals, ${longWr.toFixed(1)}% WR`);
    console.log(`  Short: ${shortSignals} signals, ${shortWr.toFixed(1)}% WR`);
  } else {
    console.log('  No signals');
  }

  console.log('═'.repeat(60));
}

main();
