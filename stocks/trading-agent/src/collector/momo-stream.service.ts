/**
 * MomoStreamService: persistent WebSocket connection to MoMo Screener's
 * Socket.IO live-quote feed (Engine.IO v4 over raw WS).
 *
 * Replaces AlpacaStreamService — provides tick-level data from ALL exchanges
 * (not just IEX), so there are no gaps for low-volume tickers.
 *
 * Protocol:
 *   0{…}  → Engine.IO handshake (contains pingInterval)
 *   2     → ping from server  → reply with 3 (pong)
 *   40    → Socket.IO namespace connect
 *   42["livequote","TICKER"] → subscribe to live quotes for TICKER
 *   42["stoplivequote"]      → unsubscribe from all
 *
 * Events received:
 *   livequote  → { data: [{ symbol, live: { lastPrice, totalVolume, quoteTime } }] }
 *   livechart  → { data: [{ symbol, live: { lastPrice, totalVolume, quoteTime } }] }
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import WebSocket from 'ws';
import { CandleBuilder, CandleCallback, TickCallback } from './candle-builder';

const WS_URL = 'wss://momoscreener.com/socket.io/?EIO=4&transport=websocket';
const MAX_RECONNECT_DELAY = 30_000;

@Injectable()
export class MomoStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(MomoStreamService.name);
  private readonly enabled: boolean = false; // DISABLED - using Alpaca only
  private ws: WebSocket | null = null;
  private connected = false; // Socket.IO namespace connected
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private subscribedSymbols = new Set<string>();
  private candleBuilder: CandleBuilder;
  private destroyed = false;
  
  // Stats tracking
  private stats = {
    messagesReceived: 0,
    ticksProcessed: 0,
    ticksFiltered: 0,
    lastTickTime: null as Date | null,
    symbolTicks: new Map<string, number>(),
  };

  constructor() {
    this.candleBuilder = new CandleBuilder(() => {});
    if (!this.enabled) {
      this.logger.warn('🚫 MomoStreamService DISABLED - using Alpaca WebSocket + 61s fallback only');
    }
  }

  /**
   * Initialize the stream with a candle callback and optional live-tick callback.
   * Called by CollectorService after DI is ready.
   */
  async init(onCandle: CandleCallback, onTick?: TickCallback): Promise<void> {
    if (!this.enabled) {
      this.logger.warn('🚫 MomoStreamService init() skipped - service is DISABLED');
      return;
    }
    
    this.candleBuilder = new CandleBuilder(onCandle, onTick);
    this.connect();
  }

  /**
   * Subscribe to live quotes for the given symbols.
   */
  subscribe(symbols: string[]): void {
    if (!this.enabled) {
      this.logger.debug(`🚫 MoMo subscribe skipped (DISABLED): ${symbols.join(', ')}`);
      return;
    }
    
    const newSymbols = symbols.filter((s) => !this.subscribedSymbols.has(s));
    if (!newSymbols.length) {
      this.logger.debug(`All symbols already subscribed: ${symbols.join(', ')}`);
      return;
    }
    
    for (const s of newSymbols) this.subscribedSymbols.add(s);
    this.logger.log(`Adding ${newSymbols.length} new subscriptions: ${newSymbols.join(', ')}`);
    this.logger.debug(`Total subscribed symbols: ${this.subscribedSymbols.size}`);
    
    if (this.ws?.readyState === WebSocket.OPEN && this.connected) {
      this.sendSubscribe(newSymbols);
    } else {
      this.logger.warn(`WebSocket not ready for subscription. State: ${this.ws?.readyState}, Connected: ${this.connected}. Symbols will be subscribed on reconnect.`);
    }
  }

  /**
   * Unsubscribe symbols (MoMo doesn't have per-symbol unsub,
   * so we stoplivequote and re-subscribe remaining).
   */
  unsubscribe(symbols: string[]): void {
    if (!this.enabled) {
      this.logger.debug(`🚫 MoMo unsubscribe skipped (DISABLED): ${symbols.join(', ')}`);
      return;
    }
    
    const actuallyUnsubscribed: string[] = [];
    for (const s of symbols) {
      if (this.subscribedSymbols.delete(s)) {
        actuallyUnsubscribed.push(s);
      }
    }
    
    if (actuallyUnsubscribed.length === 0) {
      this.logger.debug(`No symbols to unsubscribe from: ${symbols.join(', ')}`);
      return;
    }
    
    this.logger.log(`Unsubscribing ${actuallyUnsubscribed.length} symbols: ${actuallyUnsubscribed.join(', ')}`);
    this.logger.debug(`Remaining subscribed symbols: ${this.subscribedSymbols.size}`);
    
    if (this.ws?.readyState === WebSocket.OPEN && this.connected) {
      // Stop all, then re-subscribe remaining
      this.ws.send(`42${JSON.stringify(['stoplivequote'])}`);
      this.logger.debug(`Sent stoplivequote command`);
      if (this.subscribedSymbols.size > 0) {
        this.sendSubscribe([...this.subscribedSymbols]);
      }
    } else {
      this.logger.warn(`WebSocket not ready for unsubscribe. State: ${this.ws?.readyState}, Connected: ${this.connected}`);
    }
  }

  getSubscribedSymbols(): string[] {
    return [...this.subscribedSymbols];
  }

  isConnected(): boolean {
    if (!this.enabled) {
      return false; // Always false when disabled
    }
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  getStats() {
    return {
      ...this.stats,
      symbolTicks: Object.fromEntries(this.stats.symbolTicks),
      lastTickTime: this.stats.lastTickTime?.toISOString(),
    };
  }

  resetStats(): void {
    this.stats = {
      messagesReceived: 0,
      ticksProcessed: 0,
      ticksFiltered: 0,
      lastTickTime: null,
      symbolTicks: new Map<string, number>(),
    };
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    this.candleBuilder.flushAll();
    this.cleanup();
    this.logger.log('MomoStreamService destroyed, WS closed');
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private cleanup(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(1000, 'shutdown'); } catch { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
  }

  private connect(): void {
    if (this.destroyed) return;
    
    if (!this.enabled) {
      this.logger.warn('🚫 MoMo connect() skipped - service is DISABLED');
      return;
    }
    
    this.cleanup();

    this.logger.log('Connecting to MoMo Screener live quotes…');
    this.ws = new WebSocket(WS_URL, {
      headers: {
        Origin: 'https://momoscreener.com',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    this.ws.on('open', () => {
      this.logger.log('WebSocket open, waiting for Engine.IO handshake…');
    });

    this.ws.on('message', (raw: WebSocket.Data) => {
      const msg = raw.toString();

      // Log all non-ping messages for debugging
      if (msg !== '2' && msg !== '3' && !msg.startsWith('0{')) {
        this.logger.debug(`📨 WS Message: ${msg.slice(0, 200)}${msg.length > 200 ? '...' : ''}`);
      }

      // Engine.IO open packet: 0{"sid":"...","pingInterval":25000,...}
      if (msg.startsWith('0{')) {
        try {
          const handshake = JSON.parse(msg.slice(1));
          const interval = handshake.pingInterval || 25000;
          this.pingTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('3');
          }, interval);
          this.logger.log(`Engine.IO handshake complete, ping interval: ${interval}ms`);
        } catch { /* ignore malformed handshake */ }

        // Connect to default Socket.IO namespace
        this.ws!.send('40');
        return;
      }

      // Engine.IO ping → pong
      if (msg === '2') {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('3');
        return;
      }
      // Engine.IO pong (ignore)
      if (msg === '3') return;

      // Socket.IO namespace connect ack: 40{"sid":"..."}
      if (msg.startsWith('40')) {
        this.connected = true;
        this.reconnectAttempt = 0;
        this.logger.log('✓ MoMo Socket.IO namespace connected');
        // Re-subscribe all symbols
        if (this.subscribedSymbols.size > 0) {
          this.logger.log(`Re-subscribing to ${this.subscribedSymbols.size} symbols after reconnect: ${[...this.subscribedSymbols].join(', ')}`);
          this.sendSubscribe([...this.subscribedSymbols]);
        } else {
          this.logger.log('No symbols to re-subscribe after reconnect');
        }
        return;
      }

      // Socket.IO event: 42["eventName", {...}]
      if (msg.startsWith('42')) {
        this.handleEvent(msg);
        return;
      }
    });

    this.ws.on('error', (err: Error) => {
      this.logger.error(`WebSocket error: ${err.message}`);
    });

    this.ws.on('close', () => {
      this.logger.warn('WebSocket closed');
      this.connected = false;
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      this.scheduleReconnect();
    });
  }

  private handleEvent(raw: string): void {
    this.stats.messagesReceived++;
    
    let data: unknown[];
    try {
      data = JSON.parse(raw.slice(2));
    } catch { 
      this.logger.warn(`Failed to parse WebSocket message: ${raw.slice(0, 100)}...`);
      return; 
    }

    const event = data[0] as string;
    const body = data[1] as Record<string, unknown> | undefined;
    if (!body) {
      this.logger.debug(`Received event '${event}' with no body`);
      return;
    }

    // livequote → { data: [ { symbol, live: { lastPrice, totalVolume, quoteTime }, quote: { ... } } ] }
    if (event === 'livequote' && Array.isArray(body.data)) {
      this.logger.debug(`📡 Received livequote with ${body.data.length} symbols`);
      for (const item of body.data as Record<string, unknown>[]) {
        this.processQuote(item, 'livequote');
      }
      return;
    }

    // livechart → same structure
    if (event === 'livechart' && Array.isArray(body.data)) {
      this.logger.debug(`📈 Received livechart with ${body.data.length} symbols`);
      for (const item of body.data as Record<string, unknown>[]) {
        this.processQuote(item, 'livechart');
      }
      return;
    }

    // Log other events we might receive
    this.logger.debug(`Received unhandled event: ${event}`);
  }

  private processQuote(item: Record<string, unknown>, source: string = 'unknown'): void {
    const sym = ((item.symbol as string) || '').toUpperCase();
    if (!sym) {
      this.logger.debug(`${source}: Received item with no symbol`);
      return;
    }
    
    if (!this.subscribedSymbols.has(sym)) {
      this.logger.debug(`${source}: Ignoring unsubscribed symbol: ${sym}`);
      return;
    }

    const live = item.live as Record<string, unknown> | undefined;
    if (!live) {
      this.logger.debug(`${source}: No live data for ${sym}`);
      return;
    }

    const price = live.lastPrice as number;
    const totalVolume = live.totalVolume as number;
    const quoteTime = live.quoteTime as number; // unix ms

    if (typeof price !== 'number' || typeof quoteTime !== 'number') {
      this.logger.debug(`${source}: Invalid data for ${sym} - price: ${price}, time: ${quoteTime}`);
      return;
    }

    // Filter: only accept ticks during regular market hours (9:30-16:00 ET)
    const d = new Date(quoteTime);
    const etParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const h = parseInt(etParts.find((p) => p.type === 'hour')?.value ?? '0', 10);
    const m = parseInt(etParts.find((p) => p.type === 'minute')?.value ?? '0', 10);
    const minuteOfDay = h * 60 + m;
    
    const timeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    
    if (minuteOfDay < 570 || minuteOfDay >= 960) { // before 9:30 or >= 16:00
      this.stats.ticksFiltered++;
      this.logger.debug(`${source}: Filtered ${sym} tick at ${timeStr} ET (outside market hours)`);
      return; 
    }

    // Update stats
    this.stats.ticksProcessed++;
    this.stats.lastTickTime = new Date();
    const currentCount = this.stats.symbolTicks.get(sym) || 0;
    this.stats.symbolTicks.set(sym, currentCount + 1);

    this.logger.log(`🎯 ${source}: ${sym} price=${price.toFixed(3)} vol=${totalVolume || 'N/A'} time=${timeStr} ET`);

    // MoMo gives totalVolume, not per-tick size. CandleBuilder expects per-tick size.
    // The tick is mainly for price movement / candle OHLC updates.
    const size = typeof totalVolume === 'number' ? 1 : 0; // minimal size to register the tick
    this.candleBuilder.onTrade(sym, price, size, quoteTime);
  }

  private sendSubscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const sym of symbols) {
      this.ws.send(`42${JSON.stringify(['livequote', sym])}`);
    }
    this.logger.log(`Subscribed to MoMo livequotes: ${symbols.join(', ')}`);
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), MAX_RECONNECT_DELAY);
    this.reconnectAttempt++;
    this.logger.log(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempt})…`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
