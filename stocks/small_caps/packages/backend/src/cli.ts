/**
 * CLI entry point for data sync.
 * Usage: npx ts-node src/cli.ts sync --from 2023-01-01 --to 2026-03-27
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SyncWorkerService } from './data-sync/sync-worker.service';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== 'sync') {
    console.log('Usage: ts-node src/cli.ts sync --from YYYY-MM-DD --to YYYY-MM-DD');
    process.exit(1);
  }

  const fromIdx = args.indexOf('--from');
  const toIdx = args.indexOf('--to');
  const fromDate = fromIdx >= 0 ? args[fromIdx + 1] : '2023-01-01';
  const toDate = toIdx >= 0 ? args[toIdx + 1] : '2026-03-27';

  const app = await NestFactory.createApplicationContext(AppModule);
  const syncService = app.get(SyncWorkerService);

  console.log(`Starting sync: ${fromDate} → ${toDate}`);
  const start = Date.now();
  await syncService.syncDateRange(fromDate, toDate);
  console.log(`Sync complete in ${((Date.now() - start) / 1000).toFixed(1)}s`);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
