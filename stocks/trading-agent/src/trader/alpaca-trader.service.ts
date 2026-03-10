/**
 * AlpacaTraderService: thin wrapper around Alpaca Paper Trading REST API v2.
 * Uses raw axios — no SDK dependency needed.
 */

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
}

@Injectable()
export class AlpacaTraderService {
  private readonly logger = new Logger(AlpacaTraderService.name);
  private client: AxiosInstance;
  private enabled = false;

  constructor() {
    const baseURL = process.env.ALPACA_PAPER_BASE_URL || 'https://paper-api.alpaca.markets/v2';
    const keyId = process.env.ALPACA_PAPER_KEY_ID || '';
    const secretKey = process.env.ALPACA_PAPER_SECRET_KEY || '';

    this.enabled = !!(keyId && secretKey);

    this.client = axios.create({
      baseURL,
      headers: {
        'APCA-API-KEY-ID': keyId,
        'APCA-API-SECRET-KEY': secretKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    if (this.enabled) {
      this.logger.log('AlpacaTraderService configured (paper trading)');
    } else {
      this.logger.warn('AlpacaTraderService: missing ALPACA_PAPER keys — trading disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async getAccount(): Promise<AlpacaAccount> {
    const { data } = await this.client.get('/account');
    return {
      equity: parseFloat(data.equity),
      buying_power: parseFloat(data.buying_power),
      cash: parseFloat(data.cash),
    };
  }

  /**
   * Buy a symbol with a dollar amount (market order, fractional qty).
   */
  async buyMarket(symbol: string, dollarAmount: number): Promise<AlpacaOrder> {
    this.logger.log(`BUY ${symbol} ~$${dollarAmount.toFixed(2)} (market)`);
    const { data } = await this.client.post('/orders', {
      symbol: symbol.toUpperCase(),
      notional: dollarAmount.toFixed(2),
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    });
    return data as AlpacaOrder;
  }

  /**
   * Sell a position by quantity (market order).
   */
  async sellMarket(symbol: string, qty: number): Promise<AlpacaOrder> {
    this.logger.log(`SELL ${symbol} qty=${qty} (market)`);
    const { data } = await this.client.post('/orders', {
      symbol: symbol.toUpperCase(),
      qty: String(qty),
      side: 'sell',
      type: 'market',
      time_in_force: 'day',
    });
    return data as AlpacaOrder;
  }

  /**
   * Get current position for a symbol (null if no position).
   */
  async getPosition(symbol: string): Promise<AlpacaPosition | null> {
    try {
      const { data } = await this.client.get(`/positions/${symbol.toUpperCase()}`);
      return {
        symbol: data.symbol,
        qty: parseFloat(data.qty),
        avg_entry_price: parseFloat(data.avg_entry_price),
        current_price: parseFloat(data.current_price),
        market_value: parseFloat(data.market_value),
        unrealized_pl: parseFloat(data.unrealized_pl),
      };
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  }

  /**
   * Get all open positions.
   */
  async getAllPositions(): Promise<AlpacaPosition[]> {
    const { data } = await this.client.get('/positions');
    return (data as any[]).map((p) => ({
      symbol: p.symbol,
      qty: parseFloat(p.qty),
      avg_entry_price: parseFloat(p.avg_entry_price),
      current_price: parseFloat(p.current_price),
      market_value: parseFloat(p.market_value),
      unrealized_pl: parseFloat(p.unrealized_pl),
    }));
  }
}
