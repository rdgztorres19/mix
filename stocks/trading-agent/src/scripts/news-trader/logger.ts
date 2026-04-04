/**
 * logger.ts — Trade logging for news-trader.
 * Logs to console + file (logs/{date}.jsonl).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TradeSignal } from './config';

export class TradeLogger {
  private readonly logDir: string;
  private readonly logPath: string;
  private signals = 0;
  private entries = 0;
  private exits = 0;
  private wins = 0;
  private losses = 0;
  private totalPnl = 0;

  constructor() {
    this.logDir = path.resolve(__dirname, 'logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    const date = new Date().toISOString().slice(0, 10);
    this.logPath = path.join(this.logDir, `${date}.jsonl`);
  }

  private appendLog(entry: Record<string, unknown>): void {
    const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
    fs.appendFileSync(this.logPath, line + '\n');
  }

  logSignal(signal: TradeSignal): void {
    this.signals++;
    console.log(
      `\n  📰 [SIGNAL] ${signal.direction.toUpperCase()} ${signal.symbol} | ` +
      `${signal.strength} ${signal.category} | TP=${signal.tpPct}% SL=${signal.slPct}%`
    );
    console.log(`     "${signal.headline}"`);
    this.appendLog({ type: 'signal', ...signal });
  }

  logEntry(signal: TradeSignal, orderId: string, price: number, isPremarket: boolean): void {
    this.entries++;
    const mode = isPremarket ? 'PREMARKET' : 'REGULAR';
    console.log(
      `  ✅ [ENTRY] ${signal.direction.toUpperCase()} ${signal.symbol} @ $${price.toFixed(2)} | ` +
      `Order: ${orderId.slice(0, 8)}... | ${mode}`
    );
    this.appendLog({
      type: 'entry', symbol: signal.symbol, direction: signal.direction,
      price, orderId, isPremarket, headline: signal.headline,
    });
  }

  logExit(symbol: string, reason: string, pnlPct: number): void {
    this.exits++;
    this.totalPnl += pnlPct;
    if (pnlPct > 0) this.wins++;
    else if (pnlPct < 0) this.losses++;

    const emoji = pnlPct > 0 ? '🟢' : pnlPct < 0 ? '🔴' : '⚪';
    console.log(
      `  ${emoji} [EXIT] ${symbol} | ${reason} | PnL: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`
    );
    this.appendLog({ type: 'exit', symbol, reason, pnlPct });
  }

  logSkip(headline: string, symbols: string[], reason: string): void {
    console.log(`  ⏭️  [SKIP] ${symbols.join(',')} | ${reason} | "${headline.slice(0, 60)}..."`);
    this.appendLog({ type: 'skip', symbols, reason, headline: headline.slice(0, 100) });
  }

  logInfo(msg: string): void {
    console.log(`  ℹ️  ${msg}`);
  }

  printSummary(): void {
    console.log('\n' + '═'.repeat(60));
    console.log('  NEWS TRADER — SESSION SUMMARY');
    console.log('═'.repeat(60));
    console.log(`  Signals received: ${this.signals}`);
    console.log(`  Entries placed:   ${this.entries}`);
    console.log(`  Exits:            ${this.exits}`);
    console.log(`  Wins:             ${this.wins}`);
    console.log(`  Losses:           ${this.losses}`);
    const wr = this.exits > 0 ? (this.wins / this.exits * 100) : 0;
    console.log(`  Win Rate:         ${wr.toFixed(1)}%`);
    const avgPnl = this.exits > 0 ? this.totalPnl / this.exits : 0;
    console.log(`  Avg PnL:          ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2)}%`);
    console.log(`  Total PnL:        ${this.totalPnl >= 0 ? '+' : ''}${this.totalPnl.toFixed(2)}%`);
    console.log(`  Log file:         ${this.logPath}`);
    console.log('═'.repeat(60));
  }
}
