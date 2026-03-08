#!/usr/bin/env tsx
/**
 * Recalcula la columna target del CSV existente.
 *
 * --target-type multiclass (default): target = +1/-1/0 según future_return_5m vs ±threshold
 * --target-type binary: target = 1 si return > threshold, 0 sino (mejor para desbalance)
 * --target-type break_hod: target = target_break_hod_5m (breakout prediction, suele funcionar mejor)
 *
 * Uso:
 *   npm run recompute-target -- --target-type binary --threshold 0.02
 *   npm run recompute-target -- --target-type break_hod
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { computeTargetMulticlass } from '../src/labels/target.label';
import { CSV_COLUMNS } from '../src/csv/csv-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Columnas base (31) del training.csv
const BASE_COLUMNS = [
  'symbol', 'date', 'candle_time_et', 'candle_idx', 'open', 'high', 'low', 'close', 'volume',
  'atr', 'vwap', 'high_of_day', 'low_of_day', 'change_pct_at_candle', 'ema9', 'ema20',
  'pre_market_high', 'session',
  'shares_outstanding', 'market_cap', 'gap_pct', 'premarket_volume',
  'momentum_acumulado', 'change_1m', 'change_5m', 'change_10m', 'minutes_since_hod',
  'future_return_5m', 'target', 'target_break_hod_5m', 'max_future_return_10m',
] as const;

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) {
      values.push(current.replace(/^"|"$/g, '').trim());
      current = '';
    } else current += c;
  }
  values.push(current.replace(/^"|"$/g, '').trim());
  return values;
}

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

type TargetType = 'multiclass' | 'binary' | 'break_hod';

function main() {
  const args = process.argv.slice(2);
  let threshold = 0.015;
  let targetType: TargetType = 'multiclass';
  let outputPath = path.join(__dirname, '../data/training-multiclass.csv');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--threshold' && args[i + 1]) {
      threshold = parseFloat(args[i + 1]) || 0.015;
      i++;
    } else if (args[i] === '--target-type' && args[i + 1]) {
      const t = (args[i + 1] ?? '').toLowerCase();
      if (t === 'binary' || t === 'break_hod' || t === 'multiclass') targetType = t;
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      outputPath = path.resolve(args[i + 1]);
      i++;
    }
  }

  if (targetType === 'binary') threshold = Math.max(threshold, 0.01);

  const inputPath = path.join(__dirname, '../data/training.csv');
  if (!fs.existsSync(inputPath)) {
    console.error('No existe:', inputPath);
    process.exit(1);
  }

  const content = fs.readFileSync(inputPath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) {
    console.error('CSV vacío');
    process.exit(1);
  }

  const firstLine = parseCsvLine(lines[0]);
  const hasHeader = firstLine.some((v) => String(v).toLowerCase() === 'symbol');
  const dataStart = hasHeader ? 1 : 0;
  const firstRow = dataStart < lines.length ? parseCsvLine(lines[dataStart]) : firstLine;
  const colCount = firstRow.length;
  const headers = hasHeader
    ? firstLine
    : colCount >= 58
      ? [...CSV_COLUMNS]
      : colCount >= 50
        ? [...BASE_COLUMNS, 'volume_rel', 'dist_vwap_pct', 'atr_rel', 'minute_of_day', 'rsi', 'volatility_15m', 'mom_5', 'mom_10', 'return_lag_1', 'return_lag_2', 'return_lag_3', 'dist_hod_pct', 'dist_lod_pct', 'dist_pm_high', 'break_hod', 'break_pm_high', 'range_expansion', 'float_rotation', 'dollar_volume', 'relative_dollar_volume', 'volume_spike', 'vwap_cross_up', 'dist_ema9', 'dist_ema20', 'momentum_acceleration', 'is_open', 'is_midday', 'is_power_hour', 'dist_gap', 'relative_range', 'future_return_5m', 'target', 'target_break_hod_5m', 'max_future_return_10m']
        : [...BASE_COLUMNS];

  let idxFutureReturn = headers.findIndex((h) => String(h).toLowerCase() === 'future_return_5m');
  let idxTarget = headers.findIndex((h) => String(h).toLowerCase() === 'target');
  let idxBreakHod = headers.findIndex((h) => String(h).toLowerCase() === 'target_break_hod_5m');
  if (!hasHeader && colCount >= 54 && headers.length !== colCount) {
    idxFutureReturn = colCount - 4;
    idxTarget = colCount - 3;
    idxBreakHod = colCount - 2;
  }
  if (idxFutureReturn < 0 && colCount >= 54) idxFutureReturn = colCount - 4;
  if (idxTarget < 0 && colCount >= 54) idxTarget = colCount - 3;
  if (idxBreakHod < 0 && colCount >= 54) idxBreakHod = colCount - 2;
  if (idxTarget < 0) {
    console.error('Columna target no encontrada');
    process.exit(1);
  }
  if (targetType !== 'break_hod' && idxFutureReturn < 0) {
    console.error('Columna future_return_5m no encontrada');
    process.exit(1);
  }
  if (targetType === 'break_hod' && idxBreakHod < 0) {
    console.error('Columna target_break_hod_5m no encontrada');
    process.exit(1);
  }

  const out: string[] = [];
  if (hasHeader) out.push(lines[0]);

  let updated = 0;
  const counts = { up: 0, down: 0, neutral: 0 };
  for (let i = dataStart; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (vals.length !== colCount) {
      out.push(lines[i]);
      continue;
    }
    const origTarget = vals[idxTarget] ?? '';
    let newTarget: string;
    if (targetType === 'break_hod') {
      const bh = vals[idxBreakHod] ?? '';
      newTarget = bh === '1' || bh === '1.0' ? '1' : '0';
    } else if (targetType === 'binary') {
      const ret = parseFloat(vals[idxFutureReturn] ?? '');
      newTarget = !Number.isNaN(ret) && ret > threshold ? '1' : '0';
    } else {
      const ret = parseFloat(vals[idxFutureReturn] ?? '');
      const mc = computeTargetMulticlass(Number.isNaN(ret) ? null : ret, threshold);
      newTarget = mc != null ? String(mc) : origTarget;
    }
    vals[idxTarget] = newTarget;
    if (newTarget !== origTarget) updated++;
    if (newTarget === '1') counts.up++;
    else if (newTarget === '-1') counts.down++;
    else counts.neutral++;
    out.push(vals.map(escapeCsv).join(','));
  }

  fs.writeFileSync(outputPath, out.join('\n') + '\n', 'utf-8');
  console.log(`Target type: ${targetType}${targetType !== 'break_hod' ? ` (threshold ${(threshold * 100).toFixed(2)}%)` : ''}`);
  console.log(`Filas procesadas: ${lines.length - dataStart}, target actualizados: ${updated}`);
  console.log(`Distribución: +1=${counts.up}, -1=${counts.down}, 0=${counts.neutral}`);
  console.log(`Guardado: ${outputPath}`);
}

main();
