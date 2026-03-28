import chalk from 'chalk';
import Table from 'cli-table3';
import type { TradeResult } from '../backtest-simulator/types';

const INVESTMENT = 200;

export interface CandleSignal {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prob: number;
  tradeable: boolean;
  mfr10m: number;
  trade?: TradeResult;
}

interface ConfusionMatrix {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

function colorProb(prob: number, threshold: number): string {
  const pct = (prob * 100).toFixed(1) + '%';
  if (prob >= threshold) return chalk.green.bold(pct);
  if (prob >= threshold * 0.9) return chalk.yellow(pct);
  return chalk.dim(pct);
}

function colorPnl(val: number): string {
  const str = (val >= 0 ? '+' : '') + '$' + val.toFixed(2);
  if (val > 0) return chalk.green.bold(str);
  if (val < 0) return chalk.red.bold(str);
  return chalk.gray(str);
}

function colorResult(result: string): string {
  if (result === 'win') return chalk.green.bold('win');
  if (result === 'loss') return chalk.red.bold('loss');
  return chalk.gray('--');
}

// ── Candlestick chart rendering ──────────────────────────────────────────────
const WICK = '│';
const BODY_UP = '┃';   // green candle (close > open)
const BODY_DOWN = '┃';  // red candle (close < open)
const DOJI = '─';

function renderCandlestickChart(
  signals: CandleSignal[],
  chartHeight = 24,
  chartWidth?: number,
): string[] {
  if (!signals.length) return [];

  const termWidth = chartWidth ?? Math.min(process.stdout.columns || 120, 160);
  // Each candle takes 2 chars (candle + space), reserve left margin for price labels
  const marginLeft = 10;
  const marginBottom = 2;
  const availWidth = termWidth - marginLeft - 2;
  const step = Math.max(1, Math.ceil(signals.length / availWidth));
  const sampled: CandleSignal[] = [];
  for (let i = 0; i < signals.length; i += step) {
    sampled.push(signals[i]);
  }

  const allHighs = sampled.map(s => s.high);
  const allLows = sampled.map(s => s.low);
  const maxPrice = Math.max(...allHighs);
  const minPrice = Math.min(...allLows);
  const range = maxPrice - minPrice || 0.01;

  const toRow = (price: number): number => {
    return Math.round(((price - minPrice) / range) * (chartHeight - 1));
  };

  // Build grid
  const grid: string[][] = [];
  for (let r = 0; r < chartHeight; r++) {
    grid.push(new Array(sampled.length).fill(' '));
  }

  // Draw candles
  for (let col = 0; col < sampled.length; col++) {
    const s = sampled[col];
    const highRow = toRow(s.high);
    const lowRow = toRow(s.low);
    const openRow = toRow(s.open);
    const closeRow = toRow(s.close);
    const bodyTop = Math.max(openRow, closeRow);
    const bodyBot = Math.min(openRow, closeRow);
    const isUp = s.close >= s.open;

    for (let r = lowRow; r <= highRow; r++) {
      if (r >= bodyBot && r <= bodyTop) {
        if (bodyTop === bodyBot) {
          grid[r][col] = DOJI;
        } else {
          grid[r][col] = isUp ? BODY_UP : BODY_DOWN;
        }
      } else {
        grid[r][col] = WICK;
      }
    }
  }

  // Render lines (top to bottom = high to low)
  const lines: string[] = [];
  const priceSteps = 5;
  for (let r = chartHeight - 1; r >= 0; r--) {
    let label = '';
    if (r === chartHeight - 1 || r === 0 || (chartHeight > priceSteps && r % Math.floor(chartHeight / priceSteps) === 0)) {
      const price = minPrice + (r / (chartHeight - 1)) * range;
      label = price.toFixed(3);
    }
    const margin = label.padStart(marginLeft - 1) + ' ';

    let row = '';
    for (let col = 0; col < sampled.length; col++) {
      const cell = grid[r][col];
      const s = sampled[col];
      const isUp = s.close >= s.open;
      if (cell === BODY_UP || cell === BODY_DOWN) {
        row += isUp ? chalk.green(cell) : chalk.red(cell);
      } else if (cell === DOJI) {
        row += chalk.yellow(cell);
      } else if (cell === WICK) {
        row += chalk.dim(cell);
      } else {
        row += ' ';
      }
      row += ' '; // spacing between candles
    }
    lines.push(chalk.dim(margin) + row);
  }

  // Bottom axis: time labels
  let timeAxis = ' '.repeat(marginLeft);
  const labelEvery = Math.max(1, Math.floor(sampled.length / 8));
  for (let col = 0; col < sampled.length; col++) {
    if (col % labelEvery === 0) {
      const t = sampled[col].time;
      timeAxis += t;
      // pad remaining space
      const remaining = 2 - t.length;
      if (remaining > 0) timeAxis += ' '.repeat(remaining);
    } else {
      timeAxis += '  ';
    }
  }
  lines.push(chalk.dim(timeAxis));

  // BUY markers row
  let buyRow = ' '.repeat(marginLeft);
  for (let col = 0; col < sampled.length; col++) {
    const s = sampled[col];
    if (s.tradeable) {
      const result = s.trade?.result;
      if (result === 'win') buyRow += chalk.green.bold('^');
      else if (result === 'loss') buyRow += chalk.red.bold('^');
      else buyRow += chalk.yellow('^');
    } else {
      buyRow += ' ';
    }
    buyRow += ' ';
  }
  lines.push(buyRow);

  return lines;
}

export class DebugPredictLogger {
  private readonly threshold: number;
  private readonly tpPct: number;
  private readonly slPct: number;

  constructor(threshold: number, tpPct: number, slPct: number) {
    this.threshold = threshold;
    this.tpPct = tpPct;
    this.slPct = slPct;
  }

  printHeader(symbol: string, date: string, fromTime: string, toTime: string): void {
    console.log(chalk.bgBlue.white.bold('\n  Debug Predict  '));
    console.log(
      chalk.dim('  Symbol: ') + chalk.white.bold(symbol) +
      chalk.dim(' | Date: ') + chalk.white.bold(date) +
      chalk.dim(' | Time: ') + chalk.white.bold(`${fromTime}-${toTime}`),
    );
    console.log(
      chalk.dim('  Thr: ') + chalk.yellow.bold(String(this.threshold)) +
      chalk.dim(' | TP: ') + chalk.green.bold(`${this.tpPct}%`) +
      chalk.dim(' | SL: ') + chalk.red.bold(`${this.slPct}%`) +
      chalk.dim(' | Inv: ') + chalk.white.bold(`$${INVESTMENT}`) + '\n',
    );
  }

  printTable(signals: CandleSignal[]): void {
    const tpDec = this.tpPct / 100;
    const slDec = this.slPct / 100;

    const table = new Table({
      head: ['Time', 'Open', 'High', 'Low', 'Close', 'Vol', 'Prob', 'Trade', 'MFR10m', `Real>=${this.tpPct}%`, 'TP/SL', 'Match', 'P/L', 'Cumul'].map(h => chalk.cyan(h)),
      chars: { top: '-', 'top-mid': '+', 'top-left': '+', 'top-right': '+', bottom: '-', 'bottom-mid': '+', 'bottom-left': '+', 'bottom-right': '+', left: '|', 'left-mid': '+', mid: '-', 'mid-mid': '+', right: '|', 'right-mid': '+', middle: '|' },
      style: { head: [], border: ['dim'] },
    });

    let cumPnl = 0;
    const cm: ConfusionMatrix = { tp: 0, fp: 0, tn: 0, fn: 0 };
    let totalTrades = 0;
    let wins = 0;
    let losses = 0;
    let neutrals = 0;

    for (const s of signals) {
      const realGood = s.mfr10m >= tpDec;
      const tpSlResult = s.trade?.result ?? 'neutral';

      // Confusion matrix
      if (s.tradeable && realGood) cm.tp++;
      else if (s.tradeable && !realGood) cm.fp++;
      else if (!s.tradeable && realGood) cm.fn++;
      else cm.tn++;

      // P/L
      let pnl = 0;
      if (s.tradeable) {
        totalTrades++;
        if (tpSlResult === 'win') { wins++; pnl = INVESTMENT * tpDec; }
        else if (tpSlResult === 'loss') { losses++; pnl = -INVESTMENT * slDec; }
        else { neutrals++; pnl = INVESTMENT * s.mfr10m; }
      }
      cumPnl += pnl;

      const match = s.tradeable === realGood;

      table.push([
        chalk.white(s.time),
        s.open.toFixed(3),
        s.high.toFixed(3),
        s.low.toFixed(3),
        s.close.toFixed(3),
        String(s.volume),
        colorProb(s.prob, this.threshold),
        s.tradeable ? chalk.green.bold('BUY') : chalk.dim('SKIP'),
        (s.mfr10m * 100).toFixed(2) + '%',
        realGood ? chalk.green('Y') : chalk.red('N'),
        s.tradeable ? colorResult(tpSlResult) : chalk.dim(''),
        match ? chalk.green('Y') : chalk.red('N'),
        s.tradeable ? colorPnl(pnl) : chalk.dim(''),
        colorPnl(cumPnl),
      ]);
    }

    console.log(table.toString());

    // Candlestick chart
    console.log(chalk.cyan.bold('\n  Candlestick Chart'));
    console.log(
      chalk.dim('  ') +
      chalk.green('^') + chalk.dim('=BUY win  ') +
      chalk.red('^') + chalk.dim('=BUY loss  ') +
      chalk.yellow('^') + chalk.dim('=BUY neutral'),
    );
    const chartLines = renderCandlestickChart(signals);
    for (const line of chartLines) console.log(line);

    this.printSummary(cm, totalTrades, wins, losses, neutrals, cumPnl);
  }

  private printSummary(
    cm: ConfusionMatrix,
    totalTrades: number,
    wins: number,
    losses: number,
    neutrals: number,
    cumPnl: number,
  ): void {
    const divider = chalk.blue('='.repeat(74));
    console.log(`\n${divider}`);
    console.log(chalk.bgBlue.white.bold('  SUMMARY  '));

    const total = cm.tp + cm.fp + cm.tn + cm.fn;
    const precision = cm.tp + cm.fp > 0 ? cm.tp / (cm.tp + cm.fp) : 0;
    const recall = cm.tp + cm.fn > 0 ? cm.tp / (cm.tp + cm.fn) : 0;
    const accuracy = total > 0 ? (cm.tp + cm.tn) / total : 0;

    console.log(
      chalk.dim('  Confusion: ') +
      chalk.green(`TP=${cm.tp}`) + '  ' +
      chalk.red(`FP=${cm.fp}`) + '  ' +
      chalk.green(`TN=${cm.tn}`) + '  ' +
      chalk.red(`FN=${cm.fn}`),
    );
    console.log(
      chalk.dim('  Precision: ') + chalk.white.bold(`${(precision * 100).toFixed(1)}%`) +
      chalk.dim('  Recall: ') + chalk.white.bold(`${(recall * 100).toFixed(1)}%`) +
      chalk.dim('  Accuracy: ') + chalk.white.bold(`${(accuracy * 100).toFixed(1)}%`),
    );

    const decided = wins + losses;
    const winRate = decided > 0 ? (wins / decided) * 100 : 0;

    console.log(
      chalk.dim('  Trades: ') + chalk.white.bold(String(totalTrades)) +
      chalk.dim(' | Win: ') + chalk.green.bold(String(wins)) +
      chalk.dim(' | Loss: ') + chalk.red.bold(String(losses)) +
      chalk.dim(' | Neutral: ') + chalk.gray(String(neutrals)),
    );
    console.log(
      chalk.dim('  Win Rate: ') +
      (winRate >= 55 ? chalk.green.bold(`${winRate.toFixed(1)}%`) :
        winRate >= 45 ? chalk.yellow.bold(`${winRate.toFixed(1)}%`) :
        chalk.red.bold(`${winRate.toFixed(1)}%`)) +
      chalk.dim(' | P/L: ') + colorPnl(cumPnl),
    );

    console.log(`${divider}\n`);
  }
}
