/**
 * AlpacaStreamService: manages a persistent WebSocket connection to Alpaca's
 * real-time trade stream (IEX free tier). Supports subscribing/unsubscribing
 * to symbols dynamically, and auto-reconnects on disconnect.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import WebSocket from 'ws';
import { CandleBuilder, CandleCallback, TickCallback } from './candle-builder';

const WS_URL = 'wss://stream.data.alpaca.markets/v2/iex';
const MAX_RECONNECT_DELAY = 30_000;

@Injectable()
export class AlpacaStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(AlpacaStreamService.name);
  private ws: WebSocket | null = null;
  private authenticated = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribedSymbols = new Set<string>();
  private candleBuilder: CandleBuilder;
  private destroyed = false;

  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor() {
    this.apiKey = process.env.ALPACA_KEY_ID ?? '';
    this.apiSecret = process.env.ALPACA_SECRET_KEY ?? '';
    this.candleBuilder = new CandleBuilder(() => {});
  }

  /**
   * Initialize the stream with a candle callback and optional live-tick callback.
   * Called by CollectorService after DI is ready.
   */
  async init(onCandle: CandleCallback, onTick?: TickCallback): Promise<void> {
    this.candleBuilder = new CandleBuilder(onCandle, onTick);
    if (!this.apiKey || !this.apiSecret) {
      this.logger.warn('ALPACA_KEY_ID / ALPACA_SECRET_KEY not set — stream disabled');
      return;
    }
    // Wait a few seconds before connecting to let any previous connection expire
    // (Alpaca IEX free tier only allows 1 concurrent WS connection per key)
    this.logger.log('Waiting 3s for previous connection to expire…');
    await new Promise((r) => setTimeout(r, 3000));
    this.connect();
  }

  /**
   * Subscribe to trade updates for the given symbols.
   */
  subscribe(symbols: string[]): void {
    const newSymbols = symbols.filter((s) => !this.subscribedSymbols.has(s));
    if (!newSymbols.length) return;
    for (const s of newSymbols) this.subscribedSymbols.add(s);
    if (this.ws?.readyState === WebSocket.OPEN && this.authenticated) {
      this.sendSubscribe(newSymbols);
    }
  }

  /**
   * Unsubscribe from trade updates for the given symbols.
   */
  unsubscribe(symbols: string[]): void {
    for (const s of symbols) this.subscribedSymbols.delete(s);
    if (this.ws?.readyState === WebSocket.OPEN && this.authenticated) {
      this.ws.send(JSON.stringify({ action: 'unsubscribe', trades: symbols }));
    }
  }

  getSubscribedSymbols(): string[] {
    return [...this.subscribedSymbols];
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.candleBuilder.flushAll();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(1000, 'shutdown'); } catch { /* ignore */ }
      this.ws = null;
    }
    this.logger.log('AlpacaStreamService destroyed, WS closed');
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private connect(): void {
    if (this.destroyed) return;
    this.authenticated = false;

    this.logger.log('Connecting to Alpaca real-time trades…');
    this.ws = new WebSocket(WS_URL);

    this.ws.on('open', () => {
      this.logger.log('WebSocket connected, authenticating…');
      this.ws!.send(JSON.stringify({
        action: 'auth',
        key: this.apiKey,
        secret: this.apiSecret,
      }));
    });

    this.ws.on('message', (raw: WebSocket.Data) => {
      let events: any[];
      try {
        events = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!Array.isArray(events)) events = [events];

      for (const ev of events) {
        if (ev.T === 'success' && ev.msg === 'authenticated') {
          this.authenticated = true;
          this.reconnectAttempt = 0;
          this.logger.log('✓ Alpaca authenticated');
          // Re-subscribe to all symbols after reconnect
          if (this.subscribedSymbols.size > 0) {
            this.sendSubscribe([...this.subscribedSymbols]);
          }
          continue;
        }

        if (ev.T === 'subscription') {
          this.logger.log(`Subscribed to trades: ${ev.trades?.join(', ') || '(none)'}`);
          continue;
        }

        if (ev.T === 'error') {
          this.logger.error(`Alpaca error: ${ev.msg} (code ${ev.code})`);
          // 406 = connection limit exceeded — another instance is already connected.
          // Close this socket and retry with longer delay.
          if (ev.code === 406) {
            this.logger.warn('Connection limit exceeded — will retry in 10s');
            if (this.ws) {
              this.ws.removeAllListeners();
              this.ws.close();
              this.ws = null;
            }
            this.authenticated = false;
            if (!this.destroyed) {
              this.reconnectTimer = setTimeout(() => this.connect(), 10_000);
            }
            return;
          }
          continue;
        }

        // Trade tick: T=t, S=symbol, p=price, s=size, t=timestamp
        if (ev.T === 't') {
          const symbol = (ev.S || '').toUpperCase();
          const price = ev.p as number;
          const size = ev.s as number;
          const ts = new Date(ev.t).getTime();
          if (symbol && typeof price === 'number' && typeof size === 'number') {
            this.candleBuilder.onTrade(symbol, price, size, ts);
          }
        }
      }
    });

    this.ws.on('error', (err: Error) => {
      this.logger.error(`WebSocket error: ${err.message}`);
    });

    this.ws.on('close', () => {
      this.logger.warn('WebSocket closed');
      this.authenticated = false;
      this.scheduleReconnect();
    });
  }

  private sendSubscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ action: 'subscribe', trades: symbols }));
    this.logger.log(`→ subscribe request: ${symbols.join(', ')}`);
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), MAX_RECONNECT_DELAY);
    this.reconnectAttempt++;
    this.logger.log(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempt})…`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
