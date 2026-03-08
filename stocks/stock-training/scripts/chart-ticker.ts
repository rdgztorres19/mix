#!/usr/bin/env npx ts-node
/**
 * Genera HTML con gráficos para un ticker del training.csv
 * Uso: npm run chart -- RVI
 *      npm run chart -- EDSA --output chart.html
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../data');
const CSV_PATH = path.join(DATA_DIR, 'training.csv');

interface CsvRow {
  symbol: string;
  date: string;
  candle_time_et: string;
  candle_idx: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  atr: number;
  vwap: number | null;
  high_of_day: number;
  low_of_day: number;
  change_pct_at_candle: number;
  ema9: number | null;
  ema20: number | null;
  pre_market_high: number | null;
  session: string;
}

function parseCsvLine(line: string, headers: string[]): Record<string, string> {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      values.push(current.replace(/^"|"$/g, '').trim());
      current = '';
    } else {
      current += c;
    }
  }
  values.push(current.replace(/^"|"$/g, '').trim());
  const row: Record<string, string> = {};
  headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
  return row;
}

function parseRow(r: Record<string, string>): CsvRow {
  const num = (v: string) => (v === '' || v === undefined ? null : Number(v));
  const num0 = (v: string) => (v === '' || v === undefined ? 0 : Number(v));
  return {
    symbol: r.symbol ?? '',
    date: r.date ?? '',
    candle_time_et: r.candle_time_et ?? '',
    candle_idx: num0(r.candle_idx),
    open: num0(r.open),
    high: num0(r.high),
    low: num0(r.low),
    close: num0(r.close),
    volume: num0(r.volume),
    atr: num0(r.atr),
    vwap: num(r.vwap),
    high_of_day: num0(r.high_of_day),
    low_of_day: num0(r.low_of_day),
    change_pct_at_candle: num0(r.change_pct_at_candle),
    ema9: num(r.ema9),
    ema20: num(r.ema20),
    pre_market_high: num(r.pre_market_high),
    session: r.session ?? '',
  };
}

function loadTickerData(ticker: string): CsvRow[] {
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`Missing ${CSV_PATH}. Run npm run build-csv first.`);
  }
  const content = fs.readFileSync(CSV_PATH, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  const tickerUpper = ticker.toUpperCase();
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const r = parseCsvLine(lines[i], headers);
    if ((r.symbol ?? '').toUpperCase() === tickerUpper) {
      rows.push(parseRow(r));
    }
  }
  return rows.sort((a, b) => a.candle_idx - b.candle_idx);
}

function generateHtml(ticker: string, rows: CsvRow[]): string {
  const meta = rows[0];
  const info = meta ? `Date: ${meta.date} | Session: ${meta.session}` : '';

  const candleData = rows.map((r) => {
    const t = Math.floor(new Date(r.date + 'T' + r.candle_time_et + ':00-05:00').getTime() / 1000);
    return { time: t, open: r.open, high: r.high, low: r.low, close: r.close };
  });
  const vwapData = rows
    .filter((r) => r.vwap != null && !isNaN(r.vwap))
    .map((r) => ({
      time: Math.floor(new Date(r.date + 'T' + r.candle_time_et + ':00-05:00').getTime() / 1000),
      value: r.vwap!,
    }));
  const ema9Data = rows
    .filter((r) => r.ema9 != null && !isNaN(r.ema9))
    .map((r) => ({
      time: Math.floor(new Date(r.date + 'T' + r.candle_time_et + ':00-05:00').getTime() / 1000),
      value: r.ema9!,
    }));
  const ema20Data = rows
    .filter((r) => r.ema20 != null && !isNaN(r.ema20))
    .map((r) => ({
      time: Math.floor(new Date(r.date + 'T' + r.candle_time_et + ':00-05:00').getTime() / 1000),
      value: r.ema20!,
    }));
  const volData = rows.map((r) => {
    const t = Math.floor(new Date(r.date + 'T' + r.candle_time_et + ':00-05:00').getTime() / 1000);
    const color = r.close >= (r.open || r.close) ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)';
    return { time: t, value: r.volume || 0, color };
  });

  const lastVwap = vwapData.length ? vwapData[vwapData.length - 1].value : null;
  const lastEma9 = ema9Data.length ? ema9Data[ema9Data.length - 1].value : null;
  const lastEma20 = ema20Data.length ? ema20Data[ema20Data.length - 1].value : null;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${ticker} — Training Data</title>
  <script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'JetBrains Mono', system-ui, sans-serif; margin: 0; padding: 0; background: #131820; color: #d1d4dc; }
    .header { padding: 12px 20px; background: #1a2030; border-bottom: 1px solid #232d3f; }
    h1 { margin: 0 0 8px; font-size: 1.25rem; color: #e2e8f0; }
    .info { color: #64748b; font-size: 0.85rem; margin-bottom: 8px; }
    .summary { color: #64748b; font-size: 0.8rem; }
    .summary span { margin-right: 12px; }
    .summary .vwap { color: #facc15; }
    .summary .ema9 { color: #38bdf8; }
    .summary .ema20 { color: #a78bfa; }
    #chart-container { height: 420px; background: #131820; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${ticker}</h1>
    <p class="info">${info}</p>
    <p class="summary">
      <span>${rows.length} velas · 1 min (ET)</span>
      ${lastVwap != null ? '<span class="vwap">VWAP ' + lastVwap.toFixed(2) + '</span>' : ''}
      ${lastEma9 != null ? '<span class="ema9">EMA9 ' + lastEma9.toFixed(2) + '</span>' : ''}
      ${lastEma20 != null ? '<span class="ema20">EMA20 ' + lastEma20.toFixed(2) + '</span>' : ''}
    </p>
  </div>
  <div id="chart-container"></div>
  <script>
    const candleData = ${JSON.stringify(candleData)};
    const vwapData = ${JSON.stringify(vwapData)};
    const ema9Data = ${JSON.stringify(ema9Data)};
    const ema20Data = ${JSON.stringify(ema20Data)};
    const volData = ${JSON.stringify(volData)};

    const chart = LightweightCharts.createChart(document.getElementById('chart-container'), {
      layout: { background: { color: '#131820' }, textColor: '#94a3b8', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
      grid: { vertLines: { color: '#1a2030', style: 2 }, horzLines: { color: '#1a2030', style: 2 } },
      width: document.getElementById('chart-container').clientWidth,
      height: 420,
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#232d3f' },
      rightPriceScale: { borderColor: '#232d3f', scaleMargins: { top: 0.05, bottom: 0.2 } },
      crosshair: { mode: 0 },
      localization: {
        timeFormatter: (ts) => new Date(ts*1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }),
        dateFormatter: (ts) => new Date(ts*1000).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }),
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444', borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    candleSeries.setData(candleData);

    const vwapSeries = chart.addLineSeries({ color: '#facc15', lineWidth: 2, title: 'VWAP', lastValueVisible: true, priceLineVisible: true });
    if (vwapData.length) vwapSeries.setData(vwapData);

    const ema9Series = chart.addLineSeries({ color: '#38bdf8', lineWidth: 1, title: 'EMA9', lastValueVisible: true, priceLineVisible: false });
    if (ema9Data.length) ema9Series.setData(ema9Data);

    const ema20Series = chart.addLineSeries({ color: '#a78bfa', lineWidth: 1, title: 'EMA20', lastValueVisible: true, priceLineVisible: false });
    if (ema20Data.length) ema20Series.setData(ema20Data);

    const volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volSeries.setData(volData);

    chart.timeScale().fitContent();

    window.addEventListener('resize', () => chart.applyOptions({ width: document.getElementById('chart-container').clientWidth }));
  </script>
</body>
</html>`;
}

async function main() {
  const args = process.argv.slice(2);
  let ticker = '';
  let outputPath = path.join(DATA_DIR, 'chart.html');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i++;
    } else if (!args[i].startsWith('-')) {
      ticker = args[i];
    }
  }

  if (!ticker) {
    console.error('Uso: npm run chart -- TICKER [--output chart.html]');
    console.error('Ejemplo: npm run chart -- RVI');
    process.exit(1);
  }

  console.log(`Buscando ${ticker} en ${CSV_PATH}...`);
  const rows = loadTickerData(ticker);
  if (rows.length === 0) {
    console.error(`No se encontraron datos para ${ticker}. ¿Ejecutaste build-csv?`);
    process.exit(1);
  }

  console.log(`Encontradas ${rows.length} velas. Generando HTML...`);
  const html = generateHtml(ticker.toUpperCase(), rows);
  fs.writeFileSync(outputPath, html, 'utf-8');
  console.log(`Guardado: ${outputPath}`);
  const absPath = path.resolve(outputPath);
  try {
    const { execSync } = await import('child_process');
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    execSync(`${cmd} "${absPath}"`, { stdio: 'ignore' });
    console.log('Abierto en el navegador.');
  } catch {
    console.log(`Abre manualmente: file://${absPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
