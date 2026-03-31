import * as dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs';
import { fork } from 'child_process';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import chalk from 'chalk';
import { hasLocalData } from '../data-downloader/file-cache';

// ── Config ───────────────────────────────────────────────────────────────────

const NUM_WORKERS = 10;

const CSV_HEADER = [
  'symbol', 'date', 'candle_time_et', 'candle_idx',
  'open', 'high', 'low', 'close', 'volume',
  'atr', 'vwap', 'high_of_day', 'low_of_day',
  'change_pct_at_candle', 'ema9', 'ema20',
  'pre_market_high', 'session',
  'shares_outstanding', 'market_cap', 'gap_pct', 'premarket_volume',
  'momentum_acumulado', 'change_1m', 'change_5m', 'change_10m',
  'minutes_since_hod',
  'future_return_5m', 'target', 'target_break_hod_5m', 'max_future_return_10m',
  'valid_for_training',
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
  const outputPath = args[2] || path.resolve(__dirname, '../../../../stock-training/data/training-v2.csv');

  if (!startDate) {
    console.error('Usage: ts-node main.ts START_DATE [END_DATE] [OUTPUT_PATH]');
    process.exit(1);
  }

  const businessDays = getBusinessDays(startDate, endDate);

  console.log(chalk.bgBlue.white.bold('\n  Build Training V2 (Multi-Process)  '));
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

  const chunks = chunkConsecutive(pendingDays, NUM_WORKERS);
  const tmpDir = path.dirname(outputPath);
  const tmpFiles = chunks.map((_, i) => path.join(tmpDir, `.training-v2-worker-${i}.csv`));

  const t0 = Date.now();
  const workerScript = path.resolve(__dirname, 'worker.ts');

  const workerPromises = chunks.map((chunk, i) => {
    if (chunk.length === 0) return Promise.resolve();

    const firstDate = chunk[0];
    const lastDate = chunk[chunk.length - 1];

    console.log(chalk.magenta(`  [W${i}]`) + chalk.dim(` ${chunk.length} days: ${firstDate} → ${lastDate}`));

    return new Promise<void>((resolve, reject) => {
      const child = fork(workerScript, [
        String(i), firstDate, lastDate, tmpFiles[i],
      ], {
        execArgv: ['-r', 'ts-node/register'],
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        env: { ...process.env },
      });

      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Worker ${i} exited with code ${code}`));
      });

      child.on('error', reject);
    });
  });

  try {
    await Promise.all(workerPromises);
  } catch (err) {
    console.error(chalk.red(`\n  Worker error: ${(err as Error).message}`));
  }

  // Concatenate results using streams (files can be 500MB+)
  console.log(chalk.cyan('\n  Concatenating worker outputs...'));

  for (let i = 0; i < tmpFiles.length; i++) {
    const exists = fs.existsSync(tmpFiles[i]);
    const size = exists ? fs.statSync(tmpFiles[i]).size : 0;
    console.log(chalk.dim(`    Worker ${i}: ${exists ? `${(size / 1024 / 1024).toFixed(1)}MB` : 'MISSING'}`));
  }

  const writeStream = fs.createWriteStream(outputPath, { flags: 'w' });
  writeStream.write(CSV_HEADER + '\n');

  let totalRows = 0;
  for (let i = 0; i < tmpFiles.length; i++) {
    if (!fs.existsSync(tmpFiles[i])) {
      console.log(chalk.red(`    Worker ${i}: file missing, skipping`));
      continue;
    }

    // Stream line-by-line to avoid memory issues
    const fileRows = await new Promise<number>((resolve, reject) => {
      let count = 0;
      const rl = require('readline').createInterface({
        input: fs.createReadStream(tmpFiles[i]),
        crlfDelay: Infinity,
      });
      rl.on('line', (line: string) => {
        if (line.trim().length > 0) {
          writeStream.write(line + '\n');
          count++;
        }
      });
      rl.on('close', () => resolve(count));
      rl.on('error', reject);
    });

    totalRows += fileRows;
    console.log(chalk.green(`    Worker ${i}: ${fileRows} rows merged`));
  }

  writeStream.end();

  if (totalRows > 0) {
    for (const f of tmpFiles) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    console.log(chalk.dim('    Temp files cleaned up'));
  } else {
    console.log(chalk.yellow('    WARNING: 0 rows — temp files preserved for debugging'));
  }

  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(chalk.bgGreen.black.bold(`\n  ✓ Done! ${totalRows} rows in ${totalElapsed}s → ${outputPath}  \n`));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
