import * as dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs';
import { fork } from 'child_process';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import chalk from 'chalk';
import { hasLocalData } from '../data-downloader/file-cache';

// ── Config ───────────────────────────────────────────────────────────────────

const NUM_WORKERS = 10; // number of parallel processes (= CPU cores to use)

const CSV_HEADER = [
  'symbol', 'date',
  'price', 'gap_pct', 'premarket_volume', 'shares_outstanding', 'market_cap',
  'atr_pct', 'volume_at_entry', 'dist_hod_pct', 'time_of_first_entry_min',
  'in_gapper', 'in_gainer_session', 'in_gainer_intraday', 'in_high_session', 'in_high_current',
  'rank_gapper', 'rank_gainer_session', 'rank_gainer_intraday', 'rank_high_session', 'rank_high_current',
  'num_ranking_types', 'max_metric_value', 'combined_rank',
  'total_signals', 'wins', 'losses', 'neutrals',
  'win_rate', 'avg_pnl', 'total_pnl', 'has_winning_trade',
].join(',');

// ── Helpers ──────────────────────────────────────────────────────────────────

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
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

function chunkConsecutive<T>(arr: T[], n: number): T[][] {
  const chunks: T[][] = [];
  const size = Math.ceil(arr.length / n);
  for (let i = 0; i < n; i++) {
    chunks.push(arr.slice(i * size, (i + 1) * size));
  }
  return chunks.filter(c => c.length > 0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const startDate = args[0];
  const endDate = args[1] || startDate;
  const outputPath = args[2] || path.resolve(__dirname, '../../../../stock-training/data/screener-training.csv');

  if (!startDate) {
    console.error('Usage: ts-node main.ts START_DATE [END_DATE] [OUTPUT_PATH]');
    process.exit(1);
  }

  const businessDays = getBusinessDays(startDate, endDate);

  console.log(chalk.bgBlue.white.bold('\n  Build Screener Training (Multi-Process)  '));
  console.log(chalk.dim(`  Range: ${startDate} → ${endDate} | Days: ${businessDays.length}`));
  console.log(chalk.dim(`  Workers: ${NUM_WORKERS} | Output: ${outputPath}\n`));

  // Filter days with local data
  const pendingDays: string[] = [];
  for (const date of businessDays) {
    if (await hasLocalData(date)) {
      pendingDays.push(date);
    }
  }

  console.log(chalk.cyan(`  ${pendingDays.length} days with local data (${businessDays.length - pendingDays.length} skipped)\n`));

  if (!pendingDays.length) {
    console.log(chalk.yellow('  No data to process.'));
    return;
  }

  // Split days into N consecutive chunks
  const chunks = chunkConsecutive(pendingDays, NUM_WORKERS);

  // Temp output files per worker
  const tmpDir = path.dirname(outputPath);
  const tmpFiles = chunks.map((_, i) => path.join(tmpDir, `.screener-worker-${i}.csv`));

  const t0 = Date.now();

  // Launch workers
  const workerScript = path.resolve(__dirname, 'worker.ts');
  const tsNodePath = path.resolve(__dirname, '../../../node_modules/.bin/ts-node');

  const workerPromises = chunks.map((chunk, i) => {
    if (chunk.length === 0) return Promise.resolve();

    const firstDate = chunk[0];
    const lastDate = chunk[chunk.length - 1];

    console.log(chalk.magenta(`  [W${i}]`) + chalk.dim(` ${chunk.length} days: ${firstDate} → ${lastDate} → ${tmpFiles[i]}`));

    return new Promise<void>((resolve, reject) => {
      const child = fork(workerScript, [
        String(i), firstDate, lastDate, tmpFiles[i], String(pendingDays.length),
      ], {
        execArgv: ['-r', 'ts-node/register'],
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env },
      });

      child.on('message', (msg: any) => {
        if (msg.type === 'progress') {
          // Progress from worker — already logged by worker itself
        }
      });

      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Worker ${i} exited with code ${code}`));
      });

      child.on('error', reject);
    });
  });

  // Wait for all workers
  try {
    await Promise.all(workerPromises);
  } catch (err) {
    console.error(chalk.red(`\n  Worker error: ${(err as Error).message}`));
  }

  // Concatenate results
  console.log(chalk.cyan('\n  Concatenating worker outputs...'));
  const writeStream = fs.createWriteStream(outputPath, { flags: 'w' });
  writeStream.write(CSV_HEADER + '\n');

  let totalRows = 0;
  for (let i = 0; i < tmpFiles.length; i++) {
    if (!fs.existsSync(tmpFiles[i])) continue;
    const content = fs.readFileSync(tmpFiles[i], 'utf-8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    totalRows += lines.length;
    for (const line of lines) {
      writeStream.write(line + '\n');
    }
    // Clean up temp file
    fs.unlinkSync(tmpFiles[i]);
  }

  writeStream.end();
  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(chalk.bgGreen.black.bold(`\n  ✓ Done! ${totalRows} stock-day rows in ${totalElapsed}s → ${outputPath}  \n`));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
