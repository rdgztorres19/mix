import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// npm run download -- 2024-01-01 2026-03-28

import chalk from 'chalk';
import { fetchBars } from './alpaca-client';
import { hasLocalData, writeLocalBars, writeLocalPrevClose, hasLocalUvxy, writeLocalUvxy } from './file-cache';

// ── Config ──────────────────────────────────────────────────────────────────

const SYMBOL = 'SPY';
const VIX_PROXY = 'UVXY';  // VIX proxy available on Alpaca
const DEFAULT_START = '2024-01-01';

// ── Helpers ─────────────────────────────────────────────────────────────────

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
    if (isWeekday(current)) days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}

function prevCloseRangeStart(date: string): string {
  return addDays(date, -10);
}

function barsPrevCloseBeforeSession(bars: { t: string; c: number }[], sessionDate: string): number | null {
  let lastClose: number | null = null;
  for (const bar of bars) {
    const barDate = bar.t.slice(0, 10);
    if (barDate < sessionDate) {
      lastClose = bar.c;
    }
  }
  return lastClose;
}

// ── Args ────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const startDate = args[0] || DEFAULT_START;
  const endDate = args[1] || new Date().toISOString().slice(0, 10);
  return { startDate, endDate };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { startDate, endDate } = parseArgs(process.argv);
  const businessDays = getBusinessDays(startDate, endDate);

  console.log(chalk.bgBlue.white.bold('\n  SP500 Data Downloader (1min)  '));
  console.log(
    chalk.dim('  Range: ') + chalk.white.bold(`${startDate} → ${endDate}`) +
    chalk.dim(' | Business days: ') + chalk.white.bold(String(businessDays.length)) + '\n',
  );

  if (!businessDays.length) {
    console.log(chalk.yellow('No business days in range.'));
    return;
  }

  for (let d = 0; d < businessDays.length; d++) {
    const date = businessDays[d];
    const label = `[${d + 1}/${businessDays.length}] ${date}`;

    if (await hasLocalData(date)) {
      console.log(chalk.green(`${label} — already downloaded, skipping`));
      continue;
    }

    console.log(chalk.cyan.bold(`\n${label} — downloading...`));

    // 1. Fetch 1m bars for SPY
    console.log(chalk.dim('  Fetching 1m bars...'));
    const t0 = Date.now();
    const result = await fetchBars([SYMBOL], date, date, '1Min');
    const bars = result[SYMBOL] ?? [];
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(chalk.dim(`  1m bars: ${bars.length} (${elapsed}s)`));

    if (bars.length === 0) {
      console.log(chalk.yellow(`  ${label} — no bars (holiday?), skipping`));
      continue;
    }

    // 2. Fetch daily bars for prev_close
    console.log(chalk.dim('  Fetching daily bars for prev_close...'));
    const rangeStart = prevCloseRangeStart(date);
    const t1 = Date.now();
    const dailyResult = await fetchBars([SYMBOL], rangeStart, date, '1Day');
    const dailyBars = dailyResult[SYMBOL] ?? [];
    const elapsed1d = ((Date.now() - t1) / 1000).toFixed(1);
    console.log(chalk.dim(`  Daily bars: ${dailyBars.length} (${elapsed1d}s)`));

    // 3. Extract prev_close
    const prevClose = barsPrevCloseBeforeSession(dailyBars, date);
    if (prevClose == null) {
      console.log(chalk.yellow(`  ${label} — no prev_close found, skipping`));
      continue;
    }
    console.log(chalk.dim(`  prev_close: ${prevClose}`));

    // 4. Write SPY to disk
    await writeLocalBars(date, bars);
    await writeLocalPrevClose(date, prevClose);

    // 5. Fetch UVXY 1m bars (VIX proxy)
    if (!(await hasLocalUvxy(date))) {
      console.log(chalk.dim('  Fetching UVXY 1m bars (VIX proxy)...'));
      const t2 = Date.now();
      const uvxyResult = await fetchBars([VIX_PROXY], date, date, '1Min');
      const uvxyBars = uvxyResult[VIX_PROXY] ?? [];
      const elapsed2 = ((Date.now() - t2) / 1000).toFixed(1);
      console.log(chalk.dim(`  UVXY bars: ${uvxyBars.length} (${elapsed2}s)`));
      if (uvxyBars.length > 0) {
        await writeLocalUvxy(date, uvxyBars);
      }
    }

    console.log(chalk.green(`  ${label} — saved to data/raw/${date}/`));
  }

  console.log(chalk.green.bold('\nDone!'));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
