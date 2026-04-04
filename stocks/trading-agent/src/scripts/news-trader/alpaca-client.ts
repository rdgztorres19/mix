/**
 * alpaca-client.ts — Unified Alpaca client for news-trader.
 *
 * Handles: News WebSocket, Paper Trading orders, Market Data queries.
 */

import WebSocket from 'ws';
import axios, { AxiosError } from 'axios';
import type { NewsArticle, AlpacaPosition, AlpacaAccount, AlpacaOrder } from './config';

export class AlpacaNewsTraderClient {
  private readonly dataKeyId: string;
  private readonly dataSecretKey: string;
  private readonly paperKeyId: string;
  private readonly paperSecretKey: string;
  private readonly paperBaseUrl: string;

  private newsWs: WebSocket | null = null;
  private newsCallback: ((article: NewsArticle) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.dataKeyId = process.env.ALPACA_KEY_ID || '';
    this.dataSecretKey = process.env.ALPACA_SECRET_KEY || '';
    this.paperKeyId = process.env.ALPACA_PAPER_KEY_ID || '';
    this.paperSecretKey = process.env.ALPACA_PAPER_SECRET_KEY || '';
    this.paperBaseUrl = process.env.ALPACA_PAPER_BASE_URL || 'https://paper-api.alpaca.markets/v2';

    if (!this.dataKeyId || !this.dataSecretKey) {
      console.error('[Alpaca] Missing ALPACA_KEY_ID / ALPACA_SECRET_KEY');
    }
    if (!this.paperKeyId || !this.paperSecretKey) {
      console.error('[Alpaca] Missing ALPACA_PAPER_KEY_ID / ALPACA_PAPER_SECRET_KEY');
    }
  }

  // ── News WebSocket ────────────────────────────────────────────────

  async connectNewsStream(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = 'wss://stream.data.alpaca.markets/v1beta1/news';
      console.log(`[News WS] Connecting to ${url}...`);

      this.newsWs = new WebSocket(url);

      this.newsWs.on('open', () => {
        console.log('[News WS] Connected, authenticating...');
        this.newsWs!.send(JSON.stringify({
          action: 'auth',
          key: this.dataKeyId,
          secret: this.dataSecretKey,
        }));
      });

      this.newsWs.on('message', (data: Buffer) => {
        try {
          const messages = JSON.parse(data.toString());
          for (const msg of Array.isArray(messages) ? messages : [messages]) {
            if (msg.T === 'success' && msg.msg === 'authenticated') {
              console.log('[News WS] Authenticated. Subscribing to all news...');
              this.newsWs!.send(JSON.stringify({
                action: 'subscribe',
                news: ['*'],
              }));
            } else if (msg.T === 'subscription') {
              console.log(`[News WS] Subscribed: ${JSON.stringify(msg.news)}`);
              resolve();
            } else if (msg.T === 'n') {
              // News article
              const article: NewsArticle = {
                id: msg.id,
                headline: msg.headline,
                created_at: msg.created_at,
                updated_at: msg.updated_at,
                symbols: msg.symbols || [],
                source: msg.source,
                summary: msg.summary || '',
                url: msg.url,
              };
              if (this.newsCallback) {
                this.newsCallback(article);
              }
            } else if (msg.T === 'error') {
              console.error(`[News WS] Error: ${msg.msg}`);
              if (msg.msg === 'auth failed') reject(new Error('Auth failed'));
            }
          }
        } catch (e) {
          // ignore parse errors
        }
      });

      this.newsWs.on('close', () => {
        console.log('[News WS] Disconnected. Reconnecting in 5s...');
        this.reconnectTimer = setTimeout(() => this.connectNewsStream().catch(console.error), 5000);
      });

      this.newsWs.on('error', (err) => {
        console.error(`[News WS] Error: ${err.message}`);
      });

      // Timeout for initial connection
      setTimeout(() => reject(new Error('News WS connection timeout')), 15000);
    });
  }

  onNews(callback: (article: NewsArticle) => void): void {
    this.newsCallback = callback;
  }

  disconnectNews(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.newsWs) {
      this.newsWs.removeAllListeners();
      this.newsWs.close();
      this.newsWs = null;
    }
  }

  // ── Paper Trading ─────────────────────────────────────────────────

  private paperHeaders() {
    return {
      'APCA-API-KEY-ID': this.paperKeyId,
      'APCA-API-SECRET-KEY': this.paperSecretKey,
      'Content-Type': 'application/json',
    };
  }

  async getAccount(): Promise<AlpacaAccount> {
    const res = await axios.get(`${this.paperBaseUrl}/account`, {
      headers: this.paperHeaders(),
    });
    return res.data;
  }

  async getPositions(): Promise<AlpacaPosition[]> {
    const res = await axios.get(`${this.paperBaseUrl}/positions`, {
      headers: this.paperHeaders(),
    });
    return res.data;
  }

  async getPosition(symbol: string): Promise<AlpacaPosition | null> {
    try {
      const res = await axios.get(`${this.paperBaseUrl}/positions/${symbol}`, {
        headers: this.paperHeaders(),
      });
      return res.data;
    } catch {
      return null;
    }
  }

  /**
   * Place a bracket order (market entry + TP limit + SL stop).
   * Only works during regular hours.
   */
  async placeBracketOrder(params: {
    symbol: string;
    side: 'buy' | 'sell';
    notional: number;
    takeProfitPct: number;
    stopLossPct: number;
    lastPrice: number;
  }): Promise<string> {
    const { symbol, side, notional, takeProfitPct, stopLossPct, lastPrice } = params;

    const tpPrice = side === 'buy'
      ? lastPrice * (1 + takeProfitPct / 100)
      : lastPrice * (1 - takeProfitPct / 100);
    const slPrice = side === 'buy'
      ? lastPrice * (1 - stopLossPct / 100)
      : lastPrice * (1 + stopLossPct / 100);

    const order = {
      symbol,
      notional: notional.toFixed(2),
      side,
      type: 'market',
      time_in_force: 'day',
      order_class: 'bracket',
      take_profit: { limit_price: tpPrice.toFixed(2) },
      stop_loss: { stop_price: slPrice.toFixed(2) },
    };

    const res = await axios.post(`${this.paperBaseUrl}/orders`, order, {
      headers: this.paperHeaders(),
    });
    return res.data.id;
  }

  /**
   * Place a limit order for premarket/extended hours.
   * No bracket — TP/SL must be managed manually.
   */
  async placeExtendedHoursOrder(params: {
    symbol: string;
    side: 'buy' | 'sell';
    notional: number;
    limitPrice: number;
  }): Promise<string> {
    const { symbol, side, notional, limitPrice } = params;

    const order = {
      symbol,
      notional: notional.toFixed(2),
      side,
      type: 'limit',
      time_in_force: 'day',
      limit_price: limitPrice.toFixed(2),
      extended_hours: true,
    };

    const res = await axios.post(`${this.paperBaseUrl}/orders`, order, {
      headers: this.paperHeaders(),
    });
    return res.data.id;
  }

  async closePosition(symbol: string): Promise<void> {
    try {
      await axios.delete(`${this.paperBaseUrl}/positions/${symbol}`, {
        headers: this.paperHeaders(),
      });
    } catch (e) {
      const err = e as AxiosError;
      if (err.response?.status !== 404) throw e;
    }
  }

  async closeAllPositions(): Promise<void> {
    await axios.delete(`${this.paperBaseUrl}/positions?cancel_orders=true`, {
      headers: this.paperHeaders(),
    });
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      await axios.delete(`${this.paperBaseUrl}/orders/${orderId}`, {
        headers: this.paperHeaders(),
      });
    } catch {
      // order may already be filled/cancelled
    }
  }

  async getOrder(orderId: string): Promise<AlpacaOrder | null> {
    try {
      const res = await axios.get(`${this.paperBaseUrl}/orders/${orderId}`, {
        headers: this.paperHeaders(),
        params: { nested: true },
      });
      return res.data;
    } catch {
      return null;
    }
  }

  // ── Market Data ───────────────────────────────────────────────────

  private dataHeaders() {
    return {
      'APCA-API-KEY-ID': this.dataKeyId,
      'APCA-API-SECRET-KEY': this.dataSecretKey,
      'Accept': 'application/json',
    };
  }

  async getLastTrade(symbol: string): Promise<{ price: number; timestamp: string } | null> {
    try {
      const res = await axios.get(
        `https://data.alpaca.markets/v2/stocks/${symbol}/trades/latest`,
        { headers: this.dataHeaders(), params: { feed: 'sip' } },
      );
      return { price: res.data.trade.p, timestamp: res.data.trade.t };
    } catch {
      return null;
    }
  }

  async getSnapshot(symbol: string): Promise<{
    price: number;
    volume: number;
    prevClose: number;
  } | null> {
    try {
      const res = await axios.get(
        `https://data.alpaca.markets/v2/stocks/${symbol}/snapshot`,
        { headers: this.dataHeaders(), params: { feed: 'sip' } },
      );
      const snap = res.data;
      return {
        price: snap.latestTrade?.p ?? snap.minuteBar?.c ?? 0,
        volume: snap.dailyBar?.v ?? 0,
        prevClose: snap.prevDailyBar?.c ?? 0,
      };
    } catch {
      return null;
    }
  }
}
