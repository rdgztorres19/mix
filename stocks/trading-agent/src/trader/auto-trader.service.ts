/**
 * AutoTraderService: orchestrator called after every candle close.
 *
 * Flow per symbol:
 *  1. If open position → increment candle counter → if >= EXIT_CANDLES, sell & emit
 *  2. If no position → run ML predict (historical mode) → emit signal to UI
 *  3. If tradeable (prob >= threshold) AND AUTO_TRADE → buy via Alpaca → emit entry
 */

import { Injectable, Logger } from '@nestjs/common';
import notifier from 'node-notifier';
import { PredictorService, PredictResult } from '../predictor/predictor.service';
import { AlpacaTraderService, AlpacaOrder } from './alpaca-trader.service';
import { PositionTrackerService, AutoPosition } from './position-tracker.service';
import type { CollectorGateway } from '../collector/collector.gateway';
import type { CandleRow } from '../collector/indicator.calculator';

@Injectable()
export class AutoTraderService {
  private readonly logger = new Logger(AutoTraderService.name);

  private readonly predictEnabled: boolean;
  private readonly tradeEnabled: boolean;
  private readonly threshold: number;
  private readonly tradePct: number;
  private readonly exitCandles: number;

  /** Set by CollectorService after both modules are wired */
  private gateway!: CollectorGateway;

  constructor(
    private readonly predictor: PredictorService,
    private readonly alpaca: AlpacaTraderService,
    private readonly positions: PositionTrackerService,
  ) {
    this.predictEnabled = process.env.AUTO_PREDICT_ENABLED === 'true';
    this.tradeEnabled = process.env.AUTO_TRADE_ENABLED === 'true';
    this.threshold = parseFloat(process.env.AUTO_PREDICT_THRESHOLD ?? '0.70');
    this.tradePct = parseFloat(process.env.AUTO_TRADE_PCT ?? '0.01');
    this.exitCandles = parseInt(process.env.AUTO_TRADE_EXIT_CANDLES ?? '10', 10);

    this.logger.log(
      `AutoTrader | predict=${this.predictEnabled} trade=${this.tradeEnabled} ` +
      `thr=${this.threshold} pct=${this.tradePct} exitCandles=${this.exitCandles}`,
    );
  }

  /** Called by CollectorService to inject the gateway (avoids circular module dep). */
  setGateway(gw: CollectorGateway): void {
    this.gateway = gw;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Main entry point
  // ═══════════════════════════════════════════════════════════════════════

  async onCandleClosed(row: CandleRow): Promise<void> {
    if (!this.predictEnabled) return;

    try {
      if (this.positions.hasOpenPosition(row.symbol)) {
        await this.trackOpenPosition(row);
      } else {
        await this.evaluateAndTrade(row);
      }
    } catch (err) {
      this.logger.warn(`AutoTrader error for ${row.symbol}: ${(err as Error).message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Open-position management
  // ═══════════════════════════════════════════════════════════════════════

  private async trackOpenPosition(row: CandleRow): Promise<void> {
    const elapsed = await this.positions.incrementCandles(row.symbol);
    this.logger.debug(`${row.symbol} position candle ${elapsed}/${this.exitCandles}`);

    if (elapsed >= this.exitCandles) {
      await this.closeAndSell(row);
    }
  }

  private async closeAndSell(row: CandleRow): Promise<void> {
    const pos = this.positions.getOpenPosition(row.symbol);
    if (!pos) return;

    const exitPrice = await this.sellViaAlpaca(row.symbol, pos.qty, row.close);
    const closed = await this.positions.closePosition(row.symbol, exitPrice);
    if (!closed) return;

    this.notifyExit(row, closed, exitPrice);
  }

  private async sellViaAlpaca(symbol: string, qty: number, fallbackPrice: number): Promise<number> {
    if (!this.alpaca.isEnabled()) return fallbackPrice;

    try {
      const order = await this.alpaca.sellMarket(symbol, qty);
      return this.parseFillPrice(order, fallbackPrice);
    } catch (err) {
      this.logger.error(`Alpaca sell failed for ${symbol}, using candle close: ${(err as Error).message}`);
      return fallbackPrice;
    }
  }

  private notifyExit(row: CandleRow, closed: AutoPosition, exitPrice: number): void {
    const pnl = closed.pnl ?? 0;

    this.gateway.emitTradeExit({
      symbol: row.symbol,
      date: row.date,
      time: row.candle_time_et,
      entryPrice: closed.entry_price,
      exitPrice,
      qty: closed.qty,
      pnl,
      candlesHeld: closed.candles_elapsed,
    });

    this.logger.log(
      `EXITED ${row.symbol}: $${exitPrice.toFixed(2)} | PnL=$${pnl.toFixed(2)} after ${closed.candles_elapsed} candles`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Predict → signal → optional entry
  // ═══════════════════════════════════════════════════════════════════════

  private async evaluateAndTrade(row: CandleRow): Promise<void> {
    const result = await this.runPrediction(row);

    this.broadcastSignal(row, result);

    if (this.shouldEnterTrade(result)) {
      await this.buyAndTrack(row);
    }
  }

  private async runPrediction(row: CandleRow): Promise<PredictResult> {
    return this.predictor.predict(
      { ticker: row.symbol, date: row.date, candle_time_et: row.candle_time_et },
      this.threshold,
    );
  }

  private broadcastSignal(row: CandleRow, result: PredictResult): void {
    this.gateway.emitPredictSignal({
      symbol: row.symbol,
      date: row.date,
      time: row.candle_time_et,
      prob: result.prob,
      threshold: this.threshold,
      tradeable: result.tradeable,
      close: row.close,
    });

    this.logger.log(
      `${row.symbol} ${row.candle_time_et} predict: prob=${(result.prob * 100).toFixed(1)}% ` +
      `tradeable=${result.tradeable} (thr=${this.threshold})`,
    );
  }

  private shouldEnterTrade(result: PredictResult): boolean {
    return result.tradeable && this.tradeEnabled && this.alpaca.isEnabled();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Buy entry
  // ═══════════════════════════════════════════════════════════════════════

  private async buyAndTrack(row: CandleRow): Promise<void> {
    try {
      const dollarAmount = await this.calculatePositionSize();
      if (dollarAmount < 1) {
        this.logger.warn(`${row.symbol}: position size too small ($${dollarAmount.toFixed(2)})`);
        return;
      }

      // Use bracket order with aggressive limit entry, TP 2% and SL 1.5%
      const order = await this.alpaca.buyBracketLimit(row.symbol, dollarAmount, row.close);
      const fillPrice = this.parseFillPrice(order, row.close);
      const qty = this.parseFillQty(order, dollarAmount, row.close);

      await this.positions.openPosition(row.symbol, fillPrice, qty, row.candle_idx, order.id);
      this.notifyEntry(row, fillPrice, qty, dollarAmount, order.id);
    } catch (err) {
      console.log(err);
      this.logger.error(`Failed to enter ${row.symbol}: ${(err as Error).message}`);
    }
  }

  private async calculatePositionSize(): Promise<number> {
    const account = await this.alpaca.getAccount();
    return account.equity * this.tradePct;
  }

  private parseFillPrice(order: AlpacaOrder, fallback: number): number {
    return order.filled_avg_price ? parseFloat(order.filled_avg_price) : fallback;
  }

  private parseFillQty(order: AlpacaOrder, dollarAmount: number, closePrice: number): number {
    return order.filled_qty ? parseFloat(order.filled_qty) : dollarAmount / closePrice;
  }

  private notifyEntry(row: CandleRow, price: number, qty: number, dollarAmount: number, orderId: string): void {
    this.gateway.emitTradeEntry({
      symbol: row.symbol,
      date: row.date,
      time: row.candle_time_et,
      price,
      qty,
      dollarAmount,
      orderId,
    });

    this.logger.log(
      `ENTERED ${row.symbol}: qty=${qty.toFixed(4)} @ $${price.toFixed(2)} ($${dollarAmount.toFixed(2)})`,
    );

    notifier.notify({
      title: 'Compra ejecutada',
      message: `${row.symbol} @ $${price.toFixed(2)} · $${dollarAmount.toFixed(2)} (${row.candle_time_et})`,
      sound: true,
      timeout: 10,
    });
  }
}
