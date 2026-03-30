import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

//npm run download-data -- 2026-03-01 2026-03-26

import chalk from 'chalk';
import { PromisePool } from '@supercharge/promise-pool';
import { AlpacaClient } from '../backtest-simulator/alpaca-client';
import { createPool, getUniverseSymbols } from '../backtest-simulator/db';
import { barsPrevCloseBeforeSession } from '../../scanner/screener/ranking/rankers/screener-rankers';
import {
  hasLocalData,
  writeLocalBars,
  writeLocalPrevClose,
} from './file-cache';

const CONCURRENCY = 10;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function getBusinessDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  let current = new Date(startDate + 'T12:00:00Z');
  const end = new Date(endDate + 'T12:00:00Z');

  while (current <= end) {
    if (isWeekday(current)) {
      days.push(current.toISOString().slice(0, 10));
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function prevCloseRangeStart(date: string): string {
  // Go back ~10 calendar days to cover holidays + weekends
  return addDays(date, -10);
}

// ── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const startDate = args[0];
  const endDate = args[1] || startDate;

  if (!startDate) {
    console.error('Usage: ts-node main.ts START_DATE [END_DATE]');
    console.error('Example: ts-node main.ts 2026-01-23 2026-01-26');
    process.exit(1);
  }

  return { startDate, endDate };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { startDate, endDate } = parseArgs(process.argv);
  const businessDays = getBusinessDays(startDate, endDate);

  console.log(chalk.bgBlue.white.bold('\n  Data Downloader  '));
  console.log(
    chalk.dim('  Range: ') + chalk.white.bold(`${startDate} → ${endDate}`) +
    chalk.dim(' | Business days: ') + chalk.white.bold(String(businessDays.length)) + '\n',
  );

  if (!businessDays.length) {
    console.log(chalk.yellow('No business days in range.'));
    return;
  }

  const pool = createPool();
  const alpacaClient = new AlpacaClient();

  try {
    // Load universe
    console.log(chalk.dim('[Init] Loading universe from screener_assets...'));
    const universe = await getUniverseSymbols(pool);
    console.log(chalk.dim(`  Universe: ${universe.length} symbols\n`));

    // Filter out already-downloaded dates
    const pendingDays: string[] = [];
    for (const date of businessDays) {
      if (await hasLocalData(date)) {
        console.log(chalk.green(`${date} — already downloaded, skipping`));
      } else {
        pendingDays.push(date);
      }
    }

    if (!pendingDays.length) {
      console.log(chalk.green.bold('\nAll dates already downloaded!'));
      return;
    }

    console.log(chalk.cyan(`\n${pendingDays.length} dates to download (concurrency: ${CONCURRENCY})\n`));

    let completed = 0;
    const t0 = Date.now();

    const { errors } = await PromisePool
      .for(pendingDays)
      .withConcurrency(CONCURRENCY)
      .process(async (date) => {
        const t = Date.now();

        // Fetch 1m bars + daily bars in parallel
        const rangeStart = prevCloseRangeStart(date);
        const [bars1m, dailyBars] = await Promise.all([
          alpacaClient.fetchUniverse1mBars(universe, date),
          alpacaClient.fetchDailyBarsRange(universe, rangeStart, date),
        ]);

        // Extract prev_close
        const prevCloseMap = new Map<string, number>();
        dailyBars.forEach((bars, sym) => {
          const pc = barsPrevCloseBeforeSession(bars, date);
          if (pc != null) prevCloseMap.set(sym, pc);
        });

        // Write to disk
        await writeLocalBars(date, bars1m);
        await writeLocalPrevClose(date, prevCloseMap);

        completed++;
        const elapsed = ((Date.now() - t) / 1000).toFixed(1);
        console.log(chalk.green(`  [${completed}/${pendingDays.length}] ${date} — ${bars1m.size} symbols, ${prevCloseMap.size} prev_close (${elapsed}s)`));
      });

    if (errors.length) {
      for (const err of errors) {
        console.error(chalk.red(`  Error on ${err.item}: ${err.message}`));
      }
    }

    const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(chalk.green.bold(`\nDone! ${completed}/${pendingDays.length} dates downloaded in ${totalElapsed}s`));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
