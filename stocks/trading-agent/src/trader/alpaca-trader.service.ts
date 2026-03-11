import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface AlpacaAccount {
  equity: number;
  buying_power: number;
  cash: number;
}

export interface AlpacaPosition {
  symbol: string;
  qty: number;
  avg_entry_price: number;
  current_price: number;
  market_value: number;
  unrealized_pl: number;
}

export interface AlpacaOrder {
  id: string;
  symbol: string;
  qty: string;
  side: string;
  type: string;
  status: string;
  filled_avg_price: string | null;
  filled_qty: string;
  order_class?: string;
  legs?: AlpacaOrder[];
}

type TimeInForce = 'day' | 'gtc';

type BracketOptions = {
  takeProfitPct?: number;
  stopLossPct?: number;
  entryAggressivenessPct?: number;
  timeInForce?: TimeInForce;
  cancelAfterMs?: number;
};

type RawAlpacaOrder = {
  id: string;
  symbol: string;
  qty: string;
  side: string;
  type: string;
  status: string;
  filled_avg_price: string | null;
  filled_qty: string;
  order_class?: string;
  legs?: RawAlpacaOrder[];
};

@Injectable()
export class AlpacaTraderService {
  private readonly logger = new Logger(AlpacaTraderService.name);
  private readonly client: AxiosInstance;
  private readonly enabled: boolean;

  private static readonly DEFAULT_CANCEL_AFTER_MS = 30_000;
  private static readonly MIN_STOP_DIFF = 0.01;

  constructor() {
    const baseURL =
      process.env.ALPACA_PAPER_BASE_URL || 'https://paper-api.alpaca.markets/v2';
    const keyId = process.env.ALPACA_PAPER_KEY_ID || '';
    const secretKey = process.env.ALPACA_PAPER_SECRET_KEY || '';

    this.enabled = Boolean(keyId && secretKey);

    this.client = axios.create({
      baseURL,
      timeout: 10_000,
      headers: {
        'APCA-API-KEY-ID': keyId,
        'APCA-API-SECRET-KEY': secretKey,
        'Content-Type': 'application/json',
      },
    });

    if (this.enabled) {
      this.logger.log('AlpacaTraderService configured (paper trading)');
    } else {
      this.logger.warn(
        'AlpacaTraderService: missing ALPACA_PAPER keys — trading disabled',
      );
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async getAccount(): Promise<AlpacaAccount> {
    this.ensureEnabled();

    const { data } = await this.client.get('/account');

    return {
      equity: this.toNumber(data.equity),
      buying_power: this.toNumber(data.buying_power),
      cash: this.toNumber(data.cash),
    };
  }

  async getPosition(symbol: string): Promise<AlpacaPosition | null> {
    this.ensureEnabled();

    try {
      const { data } = await this.client.get(`/positions/${symbol.toUpperCase()}`);
      return this.mapPosition(data);
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      this.throwAlpacaError(`Failed to get position for ${symbol}`, error);
    }
  }

  async getAllPositions(): Promise<AlpacaPosition[]> {
    this.ensureEnabled();

    const { data } = await this.client.get('/positions');
    return (data as any[]).map((position) => this.mapPosition(position));
  }

  async buyMarket(symbol: string, dollarAmount: number): Promise<AlpacaOrder> {
    this.ensureEnabled();

    if (!Number.isFinite(dollarAmount) || dollarAmount <= 0) {
      throw new Error(`Invalid dollarAmount for ${symbol}: ${dollarAmount}`);
    }

    const payload = {
      symbol: symbol.toUpperCase(),
      notional: dollarAmount.toFixed(2),
      side: 'buy' as const,
      type: 'market' as const,
      time_in_force: 'day' as const,
    };

    this.logger.log(
      `BUY MARKET ${symbol.toUpperCase()} notional=$${dollarAmount.toFixed(2)}`,
    );

    try {
      const { data } = await this.client.post('/orders', payload);
      return this.mapOrder(data);
    } catch (error: any) {
      this.throwAlpacaError(`Failed market buy for ${symbol}`, error);
    }
  }

  async sellMarket(symbol: string, qty: number): Promise<AlpacaOrder> {
    this.ensureEnabled();

    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Invalid sell qty for ${symbol}: ${qty}`);
    }

    const payload = {
      symbol: symbol.toUpperCase(),
      qty: String(qty),
      side: 'sell' as const,
      type: 'market' as const,
      time_in_force: 'day' as const,
    };

    this.logger.log(`SELL MARKET ${symbol.toUpperCase()} qty=${qty}`);

    try {
      const { data } = await this.client.post('/orders', payload);
      return this.mapOrder(data);
    } catch (error: any) {
      this.throwAlpacaError(`Failed market sell for ${symbol}`, error);
    }
  }

  async buyBracketLimit(
    symbol: string,
    dollarAmount: number,
    lastPrice: number,
    options: BracketOptions = {},
  ): Promise<AlpacaOrder> {
    this.ensureEnabled();
    this.validateBracketInputs(symbol, dollarAmount, lastPrice);

    const takeProfitPct = options.takeProfitPct ?? 0.02;
    const stopLossPct = options.stopLossPct ?? 0.03;
    const entryAggressivenessPct = options.entryAggressivenessPct ?? 0.001;
    const timeInForce = options.timeInForce ?? 'day';
    const cancelAfterMs =
      options.cancelAfterMs ?? AlpacaTraderService.DEFAULT_CANCEL_AFTER_MS;

    const symbolUpper = symbol.toUpperCase();
    const entryLimitNum = this.calculateEntryLimit(lastPrice, entryAggressivenessPct);
    const qty = this.calculateWholeShareQty(dollarAmount, entryLimitNum, symbolUpper);

    const { takeProfit, stopLoss } = this.calculateBracketExitPrices(
      entryLimitNum,
      takeProfitPct,
      stopLossPct,
    );

    const payload = {
      symbol: symbolUpper,
      qty: String(qty),
      side: 'buy' as const,
      type: 'limit' as const,
      time_in_force: timeInForce,
      limit_price: this.roundPrice(entryLimitNum),
      order_class: 'bracket' as const,
      take_profit: {
        limit_price: this.roundPrice(takeProfit),
      },
      stop_loss: {
        stop_price: this.roundPrice(stopLoss),
      },
    };

    this.logger.log(
      `BUY BRACKET ${symbolUpper} notional=$${dollarAmount.toFixed(2)} ` +
        `entry=${payload.limit_price} tp=${payload.take_profit.limit_price} ` +
        `sl=${payload.stop_loss.stop_price} qty=${qty} tif=${timeInForce}`,
    );

    this.logger.debug?.(
      `BUY BRACKET payload ${symbolUpper}: ${JSON.stringify(payload)}`,
    );

    try {
      const { data } = await this.client.post('/orders', payload);
      const order = this.mapOrder(data);

      this.scheduleEntryOrderCancellation(order.id, symbolUpper, cancelAfterMs);

      return order;
    } catch (error: any) {
      this.throwAlpacaError(`Failed bracket buy for ${symbolUpper}`, error);
    }
  }

  async getOrder(orderId: string, nested = false): Promise<AlpacaOrder> {
    this.ensureEnabled();

    try {
      const { data } = await this.client.get('/orders/' + orderId, {
        params: nested ? { nested: true } : undefined,
      });

      return this.mapOrder(data);
    } catch (error: any) {
      this.throwAlpacaError(`Failed to get order ${orderId}`, error);
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.ensureEnabled();

    try {
      await this.client.delete(`/orders/${orderId}`);
    } catch (error: any) {
      this.throwAlpacaError(`Failed to cancel order ${orderId}`, error);
    }
  }

  private scheduleEntryOrderCancellation(
    orderId: string,
    symbol: string,
    cancelAfterMs: number,
  ): void {
    setTimeout(async () => {
      try {
        const order = await this.getOrder(orderId, true);

        if (order.status === 'filled') {
          this.logger.log(
            `Order ${orderId} (${symbol}) filled within ${cancelAfterMs}ms.`,
          );
          return;
        }

        if (!this.isCancelableStatus(order.status)) {
          this.logger.log(
            `Order ${orderId} (${symbol}) not canceled; status=${order.status}`,
          );
          return;
        }

        await this.cancelOrder(orderId);

        if (order.status === 'partially_filled') {
          this.logger.warn(
            `Order ${orderId} (${symbol}) partially filled after ${cancelAfterMs}ms; remainder canceled.`,
          );

          const position = await this.getPosition(symbol);
          if (position && position.qty > 0) {
            this.logger.warn(
              `Open position remains after partial fill: ${symbol} qty=${position.qty}. ` +
                `Decide whether to close it or re-protect it.`,
            );
          }

          return;
        }

        this.logger.warn(
          `Order ${orderId} (${symbol}) canceled after ${cancelAfterMs}ms; status=${order.status}`,
        );
      } catch (error: any) {
        this.logger.error(
          `Polling/cancel error for ${symbol}: ${this.formatAxiosError(error)}`,
        );
      }
    }, cancelAfterMs);
  }

  private validateBracketInputs(
    symbol: string,
    dollarAmount: number,
    lastPrice: number,
  ): void {
    if (!symbol?.trim()) {
      throw new Error('Symbol is required');
    }

    if (!Number.isFinite(dollarAmount) || dollarAmount <= 0) {
      throw new Error(`Invalid dollarAmount for ${symbol}: ${dollarAmount}`);
    }

    if (!Number.isFinite(lastPrice) || lastPrice <= 0) {
      throw new Error(`Invalid lastPrice for ${symbol}: ${lastPrice}`);
    }
  }

  private calculateEntryLimit(
    lastPrice: number,
    entryAggressivenessPct: number,
  ): number {
    const rawEntryPrice = lastPrice * (1 + entryAggressivenessPct);
    const entryLimit = this.toNumber(this.roundPrice(rawEntryPrice));

    if (!Number.isFinite(entryLimit) || entryLimit <= 0) {
      throw new Error(`Invalid entry limit generated: ${entryLimit}`);
    }

    return entryLimit;
  }

  private calculateWholeShareQty(
    dollarAmount: number,
    entryLimit: number,
    symbol: string,
  ): number {
    const rawQty = dollarAmount / entryLimit;

    if (!Number.isFinite(rawQty) || rawQty <= 0) {
      throw new Error(
        `Invalid qty for ${symbol}: dollarAmount=${dollarAmount}, entryLimit=${entryLimit}`,
      );
    }

    const qty = Math.floor(rawQty);

    if (qty < 1) {
      throw new Error(
        `Dollar amount too small for ${symbol}: cannot buy at least 1 share with bracket order`,
      );
    }

    return qty;
  }

  private calculateBracketExitPrices(
    entryPrice: number,
    takeProfitPct: number,
    stopLossPct: number,
  ): { takeProfit: number; stopLoss: number } {
    let takeProfit = this.toNumber(
      this.roundPrice(entryPrice * (1 + takeProfitPct)),
    );
    let stopLoss = this.toNumber(
      this.roundPrice(entryPrice * (1 - stopLossPct)),
    );

    if (entryPrice - stopLoss < AlpacaTraderService.MIN_STOP_DIFF) {
      stopLoss = entryPrice - AlpacaTraderService.MIN_STOP_DIFF;
    }

    if (stopLoss <= 0) {
      stopLoss = 0.01;
    }

    if (takeProfit <= entryPrice) {
      takeProfit = entryPrice + AlpacaTraderService.MIN_STOP_DIFF;
    }

    if (stopLoss >= entryPrice) {
      stopLoss = entryPrice - AlpacaTraderService.MIN_STOP_DIFF;
    }

    if (takeProfit <= stopLoss) {
      takeProfit = entryPrice + AlpacaTraderService.MIN_STOP_DIFF * 2;
      stopLoss = entryPrice - AlpacaTraderService.MIN_STOP_DIFF;
    }

    return { takeProfit, stopLoss };
  }

  private isCancelableStatus(status?: string): boolean {
    return [
      'new',
      'accepted',
      'pending_new',
      'accepted_for_bidding',
      'partially_filled',
      'stopped',
      'held',
      'calculated',
    ].includes(status ?? '');
  }

  private mapPosition(data: any): AlpacaPosition {
    return {
      symbol: data.symbol,
      qty: this.toNumber(data.qty),
      avg_entry_price: this.toNumber(data.avg_entry_price),
      current_price: this.toNumber(data.current_price),
      market_value: this.toNumber(data.market_value),
      unrealized_pl: this.toNumber(data.unrealized_pl),
    };
  }

  private mapOrder(data: RawAlpacaOrder): AlpacaOrder {
    return {
      id: data.id,
      symbol: data.symbol,
      qty: data.qty,
      side: data.side,
      type: data.type,
      status: data.status,
      filled_avg_price: data.filled_avg_price,
      filled_qty: data.filled_qty,
      order_class: data.order_class,
      legs: data.legs?.map((leg) => this.mapOrder(leg)),
    };
  }

  private roundPrice(price: number): string {
    if (!Number.isFinite(price)) return '0.00';
    return price >= 1 ? price.toFixed(2) : price.toFixed(4);
  }

  private toNumber(value: string | number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private ensureEnabled(): void {
    if (!this.enabled) {
      throw new Error('AlpacaTraderService disabled – missing API keys');
    }
  }

  private formatAxiosError(error: any): string {
    const status = error?.response?.status;
    const data = error?.response?.data;
    return `status=${status ?? 'unknown'} data=${JSON.stringify(data) || error.message}`;
  }

  private throwAlpacaError(context: string, error: any): never {
    const message = `${context}: ${this.formatAxiosError(error)}`;
    this.logger.error(message);
    throw new Error(message);
  }
}