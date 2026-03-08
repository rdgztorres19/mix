#!/usr/bin/env tsx
/**
 * Verifica predicciones vela por vela para un ticker y fecha.
 * Conecta a MySQL, obtiene los datos 1m, y ejecuta el modelo RF sobre cada vela.
 *
 * Uso: npm run verify-predictions -- TICKER FECHA
 * Ejemplo: npm run verify-predictions -- SOUN 2025-01-15
 */

import 'dotenv/config';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { getTickerData } from '../src/db/mysql';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FEATURE_KEYS = [
  'candle_idx', 'open', 'high', 'low', 'close', 'volume', 'atr', 'vwap',
  'high_of_day', 'low_of_day', 'change_pct_at_candle', 'ema9', 'ema20',
  'pre_market_high', 'shares_outstanding', 'market_cap', 'gap_pct',
  'premarket_volume', 'momentum_acumulado', 'change_1m', 'change_5m',
  'change_10m', 'minutes_since_hod',
  'volume_rel', 'dist_vwap_pct', 'atr_rel', 'minute_of_day', 'rsi', 'volatility_15m',
  'mom_5', 'mom_10', 'return_lag_1', 'return_lag_2', 'return_lag_3',
  'dist_hod_pct', 'dist_lod_pct', 'dist_pm_high', 'break_hod', 'break_pm_high',
  'range_expansion', 'float_rotation', 'dollar_volume', 'relative_dollar_volume',
  'volume_spike', 'vwap_cross_up', 'dist_ema9', 'dist_ema20', 'momentum_acceleration',
  'is_open', 'is_midday', 'is_power_hour', 'dist_gap', 'relative_range',
];

function getFeaturesFromRow(row: Record<string, unknown>): Record<string, number> {
  const o: Record<string, number> = {};
  for (const k of FEATURE_KEYS) {
    const v = row[k];
    o[k] = v != null && !Number.isNaN(Number(v)) ? Number(v) : 0;
  }
  return o;
}

function runPredict(features: Record<string, number>): Promise<{ predicted_class: number; proba: Record<number, number>; tradeable: boolean }> {
  return new Promise((resolve, reject) => {
    const payload = { ...features };
    const input = JSON.stringify(payload);
    const mlDir = path.join(__dirname, '..', 'ml');
    const proc = spawn('python3', ['-m', 'xgb.predict'], {
      cwd: mlDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.stdin.write(input, () => proc.stdin.end());
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || 'Predict failed'));
        return;
      }
      try {
        const out = JSON.parse(stdout);
        if (out.error) reject(new Error(out.error));
        else resolve({
          predicted_class: out.predicted_class,
          proba: out.proba || {},
          proba_bullish: out.proba_bullish ?? out.proba?.[1] ?? 0,
          tradeable: out.tradeable ?? false,
        });
      } catch {
        reject(new Error('Invalid JSON from predict'));
      }
    });
  });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return (n * 100).toFixed(2) + '%';
}

async function main() {
  const args = process.argv.slice(2);
  const ticker = args[0]?.toUpperCase() ?? '';
  const date = args[1] ?? '';

  if (!ticker || !date) {
    console.error('Uso: npm run verify-predictions -- TICKER FECHA');
    console.error('Ejemplo: npm run verify-predictions -- SOUN 2025-01-15');
    process.exit(1);
  }

  console.log(`\nVerificando predicciones (multiclase): ${ticker} ${date}\n`);

  const rows = await getTickerData(ticker, date, '1m');
  if (rows.length === 0) {
    console.error(`No hay datos para ${ticker} en ${date}. ¿Ejecutaste npm run sync-mysql?`);
    process.exit(1);
  }

  const predLabel = (c: number) => (c === 1 ? 'Alc' : c === -1 ? 'Baj' : 'Neu');
  console.log(`Velas: ${rows.length}\n`);
  console.log('idx  | time   | target | ret 5m   | pred | P(bull) | Trade? (>0.7)');
  console.log('-----|--------|--------|----------|------|---------|----------');

  let alcista = 0;
  let total = 0;
  for (const row of rows) {
    const features = getFeaturesFromRow(row);
    const { predicted_class, proba_bullish, tradeable } = await runPredict(features);
    const idx = String(row.candle_idx ?? '').padStart(3);
    const time = String(row.candle_time_et ?? '').padEnd(6);
    const tgt = row.target != null ? String(row.target) : '—';
    const ret5m = fmtPct(row.future_return_5m as number).padStart(8);
    const predStr = predLabel(predicted_class);
    const probStr = (proba_bullish * 100).toFixed(1).padStart(5) + '%';
    const op = tradeable ? 'Sí' : 'No';
    if (tradeable) alcista++;
    total++;
    console.log(`${idx}  | ${time} | ${tgt.padEnd(6)} | ${ret5m} | ${predStr.padEnd(4)} | ${probStr} | ${op}`);
  }

  console.log('\n-----');
  console.log(`Alcistas (pred=1): ${alcista}/${total}`);
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
