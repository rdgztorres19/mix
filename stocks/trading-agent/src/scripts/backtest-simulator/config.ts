import type { SimConfig } from './types';

export function parseArgs(argv: string[]): SimConfig {
  const args = argv.slice(2).filter((a) => a !== '--');

  if (args.length < 6) {
    console.error(
      'Usage: npx ts-node src/scripts/backtest-simulator/main.ts <date> <startTime> <endTime> <threshold> <targetPct> <stopLossPct>',
    );
    console.error(
      'Example: npx ts-node src/scripts/backtest-simulator/main.ts 2026-03-25 09:30 11:00 0.65 4 2',
    );
    process.exit(1);
  }

  const [date, startTime, endTime, thresholdStr, targetStr, stopStr] = args;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error(`Invalid date format: ${date}. Expected YYYY-MM-DD`);
    process.exit(1);
  }
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    console.error(`Invalid time format. Expected HH:MM`);
    process.exit(1);
  }

  const threshold = parseFloat(thresholdStr);
  const targetPct = parseFloat(targetStr);
  const stopLossPct = parseFloat(stopStr);

  if ([threshold, targetPct, stopLossPct].some((v) => isNaN(v) || v <= 0)) {
    console.error('threshold, targetPct, and stopLossPct must be positive numbers');
    process.exit(1);
  }

  return { date, startTime, endTime, threshold, targetPct, stopLossPct };
}
