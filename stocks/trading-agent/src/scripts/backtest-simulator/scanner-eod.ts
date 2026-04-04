#!/usr/bin/env npx ts-node
/**
 * scanner-eod.ts — End-of-day scanner: given a date, show top movers of the full session.
 *
 * Usage:
 *   npx ts-node src/scripts/backtest-simulator/scanner-eod.ts 2026-03-27
 *   npx ts-node src/scripts/backtest-simulator/scanner-eod.ts 2026-03-27 --top 50
 *   npx ts-node src/scripts/backtest-simulator/scanner-eod.ts 2026-03-27 --sort gap
 *   npx ts-node src/scripts/backtest-simulator/scanner-eod.ts 2026-03-27 --sort change --order asc
 *   npx ts-node src/scripts/backtest-simulator/scanner-eod.ts 2026-03-27 --sort range --top 50 --min-vol 500000
 */

import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { hasLocalData, readLocalBars, readLocalPrevClose } from '../data-downloader/file-cache';
import { BacktestScreener } from './screener';
import chalk from 'chalk';

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const allArgs = process.argv.slice(2);

  const date = args[0];
  if (!date) {
    console.error('Usage: scanner-eod.ts <date> [--top N] [--sort gap|change|range|volume] [--order asc|desc] [--min-vol N]');
    process.exit(1);
  }

  let topN = 30;
  let minVol = 250_000;
  let sortBy: 'default' | 'gap' | 'change' | 'range' | 'volume' = 'default';
  let order: 'asc' | 'desc' = 'desc';

  for (let i = 0; i < allArgs.length; i++) {
    if (allArgs[i] === '--top' && allArgs[i + 1]) topN = parseInt(allArgs[i + 1]);
    if (allArgs[i] === '--min-vol' && allArgs[i + 1]) minVol = parseInt(allArgs[i + 1]);
    if (allArgs[i] === '--sort' && allArgs[i + 1]) sortBy = allArgs[i + 1] as any;
    if (allArgs[i] === '--order' && allArgs[i + 1]) order = allArgs[i + 1] as any;
  }

  const sortLabel = sortBy === 'default' ? 'screener rank' : `${sortBy} ${order}`;

  console.log(chalk.bgCyan.black.bold('\n  EOD Scanner  '));
  console.log(
    chalk.dim('  Date: ') + chalk.white.bold(date) +
    chalk.dim(' | Top: ') + chalk.yellow.bold(String(topN)) +
    chalk.dim(' | Sort: ') + chalk.yellow.bold(sortLabel) +
    chalk.dim(' | Min Vol: ') + chalk.yellow.bold(minVol.toLocaleString()) + '\n',
  );

  // 1. Load local data
  if (!(await hasLocalData(date))) {
    console.error(chalk.red(`  No local data for ${date}. Run data-downloader first.`));
    process.exit(1);
  }

  const allBars = await readLocalBars(date);
  const prevCloseMap = await readLocalPrevClose(date);
  console.log(chalk.green(`  Loaded: ${allBars.size} symbols, ${prevCloseMap.size} prev_close entries`));

  // 2. Filter by volume, use ALL candles (full day)
  const candlesBySymbol = new Map<string, { o: number; h: number; l: number; c: number; v: number; t: number }[]>();
  let skippedLowVol = 0;

  for (const [sym, bars] of allBars) {
    let totalVol = 0;
    for (const b of bars) totalVol += b.v;
    if (totalVol < minVol) { skippedLowVol++; continue; }
    const candles = bars
      .map(b => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, t: new Date(b.t).getTime() }))
      .sort((a, b) => a.t - b.t);
    candlesBySymbol.set(sym.toUpperCase(), candles);
  }

  console.log(chalk.green(`  After filters: ${candlesBySymbol.size} symbols (${skippedLowVol} low-vol skipped)\n`));

  // 3. Build snapshots + run screener
  const screener = new BacktestScreener(topN, 500_000);
  const snapshots = screener.buildSyntheticSnapshots(candlesBySymbol as any, prevCloseMap);
  const result = screener.computeCombinedListWide(snapshots, date, prevCloseMap, true, topN);

  // 4. Build rows with metrics
  interface Row {
    sym: string;
    o: number; h: number; l: number; c: number; v: number;
    gapPct: number; changePct: number; rangePct: number;
    rankLabels: string;
  }

  const rows: Row[] = [];
  for (const sym of result.symbols) {
    const snap = snapshots[sym];
    if (!snap) continue;
    const { o, h, l, c, v } = snap.dailyBar;
    const prevClose = prevCloseMap.get(sym) ?? 0;
    const gapPct = prevClose > 0 ? ((o - prevClose) / prevClose) * 100 : 0;
    const changePct = prevClose > 0 ? ((c - prevClose) / prevClose) * 100 : 0;
    const rangePct = l > 0 ? ((h - l) / l) * 100 : 0;

    const reasons = result.reasons.get(sym);
    const rankLabels = reasons
      ? [...reasons].map(r => {
          const pos = result.rankPositions.get(sym)?.get(r);
          const label = r.replace('gainer_', '').replace('high_', 'hi_');
          return pos != null ? `${label}#${pos + 1}` : label;
        }).join(', ')
      : '';

    rows.push({ sym, o, h, l, c, v, gapPct, changePct, rangePct, rankLabels });
  }

  // Sort
  if (sortBy !== 'default') {
    const key = sortBy === 'gap' ? 'gapPct'
      : sortBy === 'change' ? 'changePct'
      : sortBy === 'range' ? 'rangePct'
      : 'v';
    rows.sort((a, b) => order === 'desc' ? b[key] - a[key] : a[key] - b[key]);
  }

  // Print
  console.log(chalk.cyan(`  Top ${rows.length} Movers — Full Session\n`));

  console.log(
    chalk.dim('  #  ') +
    chalk.white.bold('Symbol'.padEnd(8)) +
    chalk.white.bold('Open'.padStart(9)) +
    chalk.white.bold('High'.padStart(9)) +
    chalk.white.bold('Low'.padStart(9)) +
    chalk.white.bold('Close'.padStart(9)) +
    chalk.white.bold('Gap%'.padStart(8)) +
    chalk.white.bold('Change%'.padStart(9)) +
    chalk.white.bold('Range%'.padStart(8)) +
    chalk.white.bold('Volume'.padStart(12)) +
    chalk.white.bold('  Rankings'),
  );
  console.log(chalk.dim('  ' + '─'.repeat(100)));

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const gapColor = r.gapPct >= 0 ? chalk.green : chalk.red;
    const changeColor = r.changePct >= 0 ? chalk.green : chalk.red;

    console.log(
      chalk.dim(`  ${String(i + 1).padStart(2)} `) +
      chalk.white.bold(r.sym.padEnd(8)) +
      chalk.white(`$${r.o.toFixed(2)}`.padStart(9)) +
      chalk.green(`$${r.h.toFixed(2)}`.padStart(9)) +
      chalk.red(`$${r.l.toFixed(2)}`.padStart(9)) +
      chalk.white(`$${r.c.toFixed(2)}`.padStart(9)) +
      gapColor((`${r.gapPct >= 0 ? '+' : ''}${r.gapPct.toFixed(1)}%`).padStart(8)) +
      changeColor((`${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(1)}%`).padStart(9)) +
      chalk.yellow((`${r.rangePct.toFixed(1)}%`).padStart(8)) +
      chalk.yellow(r.v.toLocaleString().padStart(12)) +
      chalk.dim('  ' + r.rankLabels),
    );
  }

  console.log(chalk.dim('\n  ' + '─'.repeat(100)));

  // 5. Summary
  let sumGap = 0, sumChange = 0, sumRange = 0;
  for (const r of rows) {
    sumGap += r.gapPct;
    sumChange += r.changePct;
    sumRange += r.rangePct;
  }
  const n = rows.length;
  console.log(
    chalk.dim('  Avg Gap: ') + chalk.yellow(`${(sumGap / n).toFixed(1)}%`) +
    chalk.dim(' | Avg Change: ') + chalk.yellow(`${(sumChange / n).toFixed(1)}%`) +
    chalk.dim(' | Avg Range: ') + chalk.yellow(`${(sumRange / n).toFixed(1)}%`) +
    chalk.dim(` | Scanned: ${Object.keys(snapshots).length}`),
  );
  console.log('');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
