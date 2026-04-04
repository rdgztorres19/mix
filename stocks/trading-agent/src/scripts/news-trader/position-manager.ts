/**
 * position-manager.ts — Track active positions, enforce limits, handle exits.
 */

import type { ActivePosition, TradeConfig } from './config';
import { isPremarket, isForceCloseTime, nowET } from './config';
import type { AlpacaNewsTraderClient } from './alpaca-client';

export class PositionManager {
  private positions = new Map<string, ActivePosition>();

  canEnter(symbol: string, config: TradeConfig): boolean {
    if (this.positions.has(symbol)) return false;
    if (this.positions.size >= config.maxPositions) return false;
    return true;
  }

  addPosition(pos: ActivePosition): void {
    this.positions.set(pos.symbol, pos);
  }

  removePosition(symbol: string): void {
    this.positions.delete(symbol);
  }

  getPosition(symbol: string): ActivePosition | undefined {
    return this.positions.get(symbol);
  }

  getAll(): ActivePosition[] {
    return [...this.positions.values()];
  }

  get size(): number {
    return this.positions.size;
  }

  /**
   * Check positions for time-based exits and manual TP/SL (premarket).
   */
  async checkPositions(
    client: AlpacaNewsTraderClient,
    config: TradeConfig,
    onExit: (symbol: string, reason: string, pnlPct: number) => void,
  ): Promise<void> {
    const now = new Date();

    for (const [symbol, pos] of this.positions) {
      // Force close at end of day
      if (isForceCloseTime(config)) {
        console.log(`  [PM] Force close EOD: ${symbol}`);
        await this.closeAndRemove(client, symbol, 'eod_close', onExit);
        continue;
      }

      // Max hold time exit
      const holdMs = now.getTime() - pos.enteredAt.getTime();
      const holdMinutes = holdMs / 60_000;
      if (holdMinutes >= config.maxHoldMinutes) {
        console.log(`  [PM] Max hold time exit: ${symbol} (${holdMinutes.toFixed(0)} min)`);
        await this.closeAndRemove(client, symbol, 'max_hold', onExit);
        continue;
      }

      // Manual TP/SL for premarket positions
      if (pos.isPremarket) {
        const trade = await client.getLastTrade(symbol);
        if (!trade) continue;

        const currentPrice = trade.price;

        if (pos.direction === 'long') {
          if (currentPrice >= pos.tpLevel) {
            const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
            console.log(`  [PM] TP hit (premarket): ${symbol} @ ${currentPrice.toFixed(2)} (+${pnl.toFixed(2)}%)`);
            await this.closeAndRemove(client, symbol, 'tp_premarket', onExit);
          } else if (currentPrice <= pos.slLevel) {
            const pnl = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
            console.log(`  [PM] SL hit (premarket): ${symbol} @ ${currentPrice.toFixed(2)} (${pnl.toFixed(2)}%)`);
            await this.closeAndRemove(client, symbol, 'sl_premarket', onExit);
          }
        } else {
          // Short position
          if (currentPrice <= pos.tpLevel) {
            const pnl = ((pos.entryPrice - currentPrice) / pos.entryPrice) * 100;
            console.log(`  [PM] TP hit short (premarket): ${symbol} @ ${currentPrice.toFixed(2)} (+${pnl.toFixed(2)}%)`);
            await this.closeAndRemove(client, symbol, 'tp_premarket', onExit);
          } else if (currentPrice >= pos.slLevel) {
            const pnl = ((pos.entryPrice - currentPrice) / pos.entryPrice) * 100;
            console.log(`  [PM] SL hit short (premarket): ${symbol} @ ${currentPrice.toFixed(2)} (${pnl.toFixed(2)}%)`);
            await this.closeAndRemove(client, symbol, 'sl_premarket', onExit);
          }
        }

        // Transition: if market opened and position is still premarket, convert to bracket
        if (!isPremarket(config) && pos.isPremarket) {
          console.log(`  [PM] Market opened — premarket position ${symbol} now in regular hours`);
          pos.isPremarket = false;
          // Bracket order would need to be placed here for server-side TP/SL
          // For simplicity, we continue with manual monitoring
        }
      }
    }
  }

  async closeAllEndOfDay(
    client: AlpacaNewsTraderClient,
    onExit: (symbol: string, reason: string, pnlPct: number) => void,
  ): Promise<void> {
    console.log(`  [PM] Closing all positions (EOD)...`);
    for (const [symbol] of this.positions) {
      await this.closeAndRemove(client, symbol, 'eod_close', onExit);
    }
  }

  private async closeAndRemove(
    client: AlpacaNewsTraderClient,
    symbol: string,
    reason: string,
    onExit: (symbol: string, reason: string, pnlPct: number) => void,
  ): Promise<void> {
    const pos = this.positions.get(symbol);
    if (!pos) return;

    try {
      await client.closePosition(symbol);
    } catch (e) {
      console.error(`  [PM] Error closing ${symbol}: ${(e as Error).message}`);
    }

    // Get PnL
    let pnlPct = 0;
    try {
      const trade = await client.getLastTrade(symbol);
      if (trade) {
        pnlPct = pos.direction === 'long'
          ? ((trade.price - pos.entryPrice) / pos.entryPrice) * 100
          : ((pos.entryPrice - trade.price) / pos.entryPrice) * 100;
      }
    } catch {
      // ignore
    }

    this.positions.delete(symbol);
    onExit(symbol, reason, pnlPct);
  }
}
