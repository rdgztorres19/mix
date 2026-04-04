#!/usr/bin/env npx ts-node
/**
 * scanner.ts — Standalone scanner: given a date + time, show the screener results.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest-simulator/scanner.ts 2026-03-25
 *   npx ts-node src/scripts/backtest-simulator/scanner.ts 2026-03-25 09:45
 *   npx ts-node src/scripts/backtest-simulator/scanner.ts 2026-03-25 10:00 --top 50
 */

import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { hasLocalData, readLocalBars, readLocalPrevClose } from '../data-downloader/file-cache';
import { BacktestScreener } from './screener';
import chalk from 'chalk';

const MARKET_OPEN_MINUTE = 9 * 60 + 30;

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

function etToUnixMs(dateStr: string, timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  const targetDate = new Date(`${dateStr}T12:00:00Z`);
  const offset = getETOffset(targetDate);
  return Date.UTC(
    parseInt(dateStr.slice(0, 4)),
    parseInt(dateStr.slice(5, 7)) - 1,
    parseInt(dateStr.slice(8, 10)),
    h - offset,
    m,
    0,
  );
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter(a => a.startsWith('--'));

  const date = args[0];
  if (!date) {
    console.error('Usage: scanner.ts <date> [time] [--top N] [--min-vol N]');
    console.error('  date:     YYYY-MM-DD');
    console.error('  time:     HH:MM in ET (default: 10:00)');
    console.error('  --top N:  show top N results (default: 30)');
    console.error('  --min-vol N: minimum daily volume (default: 250000)');
    process.exit(1);
  }

  const time = args[1] || '10:00';
  let topN = 30;
  let minVol = 250_000;

  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--top' && flags[i + 1]) topN = parseInt(flags[i + 1]);
    if (flags[i] === '--min-vol' && flags[i + 1]) minVol = parseInt(flags[i + 1]);
  }

  console.log(chalk.bgCyan.black.bold('\n  Stock Scanner  '));
  console.log(
    chalk.dim('  Date: ') + chalk.white.bold(date) +
    chalk.dim(' | Time: ') + chalk.white.bold(time + ' ET') +
    chalk.dim(' | Top: ') + chalk.yellow.bold(String(topN)) +
    chalk.dim(' | Min Vol: ') + chalk.yellow.bold(minVol.toLocaleString()) + '\n',
  );

  // 1. Load local data
  if (!(await hasLocalData(date))) {
    console.error(chalk.red(`  No local data for ${date}. Run data-downloader first.`));
    process.exit(1);
  }

  console.log(chalk.dim('  Loading bars + prev_close...'));
  const allBars = await readLocalBars(date);
  const prevCloseMap = await readLocalPrevClose(date);
  console.log(chalk.green(`  Loaded: ${allBars.size} symbols, ${prevCloseMap.size} prev_close entries`));

  // 2. Filter by volume + build candles up to requested time
  const timeMs = etToUnixMs(date, time);
  const timeMin = timeToMinutes(time);
  const isAfterOpen = timeMin > MARKET_OPEN_MINUTE;

  const candlesBySymbol = new Map<string, { o: number; h: number; l: number; c: number; v: number; t: number }[]>();
  let skippedLowVol = 0;
  let skippedNoCandles = 0;

  for (const [sym, bars] of allBars) {
    let totalVol = 0;
    for (const b of bars) totalVol += b.v;
    if (totalVol < minVol) { skippedLowVol++; continue; }

    const candles = bars
      .map(b => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, t: new Date(b.t).getTime() }))
      .filter(c => c.t <= timeMs)
      .sort((a, b) => a.t - b.t);

    if (candles.length === 0) { skippedNoCandles++; continue; }
    candlesBySymbol.set(sym.toUpperCase(), candles);
  }

  console.log(chalk.green(`  After filters: ${candlesBySymbol.size} symbols (${skippedLowVol} low-vol, ${skippedNoCandles} no candles before ${time})`));

  // 3. Build snapshots + run screener
  const screener = new BacktestScreener(topN, 500_000);
  const snapshots = screener.buildSyntheticSnapshots(candlesBySymbol as any, prevCloseMap);
  const result = screener.computeCombinedListWide(snapshots, date, prevCloseMap, isAfterOpen, topN);

  // 4. Print results
  console.log(chalk.cyan(`\n  Scanner Results @ ${time} ET — ${result.symbols.length} stocks\n`));

  // Header
  console.log(
    chalk.dim('  #  ') +
    chalk.white.bold('Symbol'.padEnd(8)) +
    chalk.white.bold('Price'.padStart(9)) +
    chalk.white.bold('Gap%'.padStart(8)) +
    chalk.white.bold('Change%'.padStart(9)) +
    chalk.white.bold('Volume'.padStart(12)) +
    chalk.white.bold('  Rankings'),
  );
  console.log(chalk.dim('  ' + '─'.repeat(75)));

  for (let i = 0; i < result.symbols.length; i++) {
    const sym = result.symbols[i];
    const snap = snapshots[sym];
    if (!snap) continue;

    const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;
    const prevClose = prevCloseMap.get(sym) ?? 0;
    const gapPct = prevClose > 0 ? ((snap.dailyBar.o - prevClose) / prevClose) * 100 : 0;
    const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    const volume = snap.dailyBar?.v ?? 0;

    const reasons = result.reasons.get(sym);
    const rankLabels = reasons
      ? [...reasons].map(r => {
          const pos = result.rankPositions.get(sym)?.get(r);
          const label = r.replace('gainer_', '').replace('high_', 'hi_');
          return pos != null ? `${label}#${pos + 1}` : label;
        }).join(', ')
      : '';

    const gapColor = gapPct >= 0 ? chalk.green : chalk.red;
    const changeColor = changePct >= 0 ? chalk.green : chalk.red;

    console.log(
      chalk.dim(`  ${String(i + 1).padStart(2)} `) +
      chalk.white.bold(sym.padEnd(8)) +
      chalk.white(`$${price.toFixed(2)}`.padStart(9)) +
      gapColor((`${gapPct >= 0 ? '+' : ''}${gapPct.toFixed(1)}%`).padStart(8)) +
      changeColor((`${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%`).padStart(9)) +
      chalk.yellow(volume.toLocaleString().padStart(12)) +
      chalk.dim('  ' + rankLabels),
    );
  }

  // 5. Summary stats
  console.log(chalk.dim('\n  ' + '─'.repeat(75)));
  const avgGap = result.symbols.reduce((sum, sym) => {
    const snap = snapshots[sym];
    const pc = prevCloseMap.get(sym) ?? 0;
    if (!snap || pc <= 0) return sum;
    return sum + ((snap.dailyBar.o - pc) / pc) * 100;
  }, 0) / result.symbols.length;

  const avgChange = result.symbols.reduce((sum, sym) => {
    const snap = snapshots[sym];
    const pc = prevCloseMap.get(sym) ?? 0;
    if (!snap || pc <= 0) return sum;
    const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;
    return sum + ((price - pc) / pc) * 100;
  }, 0) / result.symbols.length;

  console.log(
    chalk.dim('  Avg Gap: ') + chalk.yellow(`${avgGap >= 0 ? '+' : ''}${avgGap.toFixed(1)}%`) +
    chalk.dim(' | Avg Change: ') + chalk.yellow(`${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(1)}%`) +
    chalk.dim(` | Total symbols scanned: ${Object.keys(snapshots).length}`),
  );
  console.log('');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
