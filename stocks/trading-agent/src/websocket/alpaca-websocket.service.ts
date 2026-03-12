import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import type { IWebSocketDataSource, RealTimeBar, WebSocketConfig } from './websocket.interface';

interface AlpacaWebSocketMessage {
  T: string;
  msg?: string;
  S?: string;
  t?: number | string;
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
  vw?: number;
  n?: number;
}

@Injectable()
export class AlpacaWebSocketService implements IWebSocketDataSource {

  private readonly logger = new Logger(AlpacaWebSocketService.name);

  private ws: WebSocket | null = null;

  private isAuthenticated = false;
  private subscriptions = new Set<string>();
  private lastSubscriptionsBeforeDisconnect: string[] = [];

  private readonly barCallbacks: Array<(bar: RealTimeBar) => void> = [];
  private readonly authCallbacks: Array<() => void | Promise<void>> = [];

  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private isReconnecting = false;
  private intentionalDisconnect = false;

  private pingInterval: NodeJS.Timeout | null = null;

  private readonly lastBarTimes = new Map<string, number>();

  private readonly config: WebSocketConfig;

  private readonly alpacaKeyId: string;
  private readonly alpacaSecretKey: string;

  private readonly wsUrl = 'wss://stream.data.alpaca.markets/v2/sip';

  constructor(private readonly configService: ConfigService) {

    this.alpacaKeyId =
      configService.get<string>('ALPACA_KEY_ID') ||
      'PKBLVB6V5QWCSU2TLPHJ';

    this.alpacaSecretKey =
      configService.get<string>('ALPACA_SECRET_KEY') ||
      'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG';

    this.config = {
      enabled: configService.get<boolean>('ALPACA_WEBSOCKET_ENABLED', true),
      reconnectIntervalMs: configService.get<number>('ALPACA_RECONNECT_INTERVAL_MS', 5000),
      symbols: [],
    };

    this.logger.log(`🚀 Alpaca WebSocket initialized`);
  }

  async connect(): Promise<void> {

    if (!this.config.enabled) return;

    this.intentionalDisconnect = false;

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.terminate();
      } catch {}
      this.ws = null;
    }

    this.logger.log('📡 Connecting to Alpaca WebSocket...');

    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => this.handleOpen());
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('close', (code, reason) => this.handleClose(code, reason));
    this.ws.on('error', (err) => this.handleError(err));
  }

  async disconnect(): Promise<void> {

    this.intentionalDisconnect = true;

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      this.logger.log('👋 Disconnecting WebSocket');
      this.ws.close();
      this.ws = null;
    }

    this.isAuthenticated = false;
  }

  async subscribe(symbols: string[]): Promise<void> {

    if (!this.isAuthenticated) {
      this.logger.warn('⚠️ Cannot subscribe — not authenticated');
      return;
    }

    const newSymbols = symbols.filter(s => !this.subscriptions.has(s));

    if (!newSymbols.length) return;

    const msg = {
      action: 'subscribe',
      bars: newSymbols
    };

    this.logger.log(`📊 Subscribing ${newSymbols.join(', ')}`);

    this.ws?.send(JSON.stringify(msg));

    newSymbols.forEach(s => this.subscriptions.add(s));
  }

  async unsubscribe(symbols: string[]): Promise<void> {

    if (!this.isAuthenticated) return;

    const existing = symbols.filter(s => this.subscriptions.has(s));
    if (!existing.length) return;

    const msg = {
      action: 'unsubscribe',
      bars: existing
    };

    this.ws?.send(JSON.stringify(msg));

    existing.forEach(s => this.subscriptions.delete(s));
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated;
  }

  onBar(callback: (bar: RealTimeBar) => void): void {
    this.barCallbacks.push(callback);
  }

  onAuthenticated(callback: () => void | Promise<void>): void {
    this.authCallbacks.push(callback);
  }

  getLastBarTime(symbol: string): number | null {
    return this.lastBarTimes.get(symbol) || null;
  }

  private handleOpen(): void {

    this.logger.log('✅ WebSocket connected — authenticating');

    const authMsg = {
      action: 'auth',
      key: this.alpacaKeyId,
      secret: this.alpacaSecretKey
    };

    this.ws?.send(JSON.stringify(authMsg));
  }

  private handleMessage(data: WebSocket.RawData): void {

    try {

      const messages: AlpacaWebSocketMessage[] = JSON.parse(data.toString());

      messages.forEach(msg => {

        switch (msg.T) {

          case 'success':
            if (msg.msg === 'authenticated') {
              this.handleAuthenticated();
            }
            break;

          case 'subscription':
            this.logger.log('📋 Subscription confirmed');
            break;

          case 'b':
            this.handleBar(msg);
            break;

          case 'error':
            this.logger.error('❌ Server error', msg);
            break;
        }
      });

    } catch (err) {
      this.logger.error(`❌ Parse error ${(err as Error).message}`);
    }
  }

  private async handleAuthenticated(): Promise<void> {

    this.logger.log('🎉 Authenticated');

    this.isAuthenticated = true;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;

    this.startPing();

    if (this.lastSubscriptionsBeforeDisconnect.length) {
      await this.subscribe(this.lastSubscriptionsBeforeDisconnect);
    }

    for (const cb of this.authCallbacks) {
      await cb();
    }
  }

  private handleBar(msg: AlpacaWebSocketMessage): void {

    if (!msg.S || !msg.t || msg.o == null || msg.h == null || msg.l == null || msg.c == null || msg.v == null) {
      return;
    }

    let tsSec = 0;

    if (typeof msg.t === 'number') {
      tsSec = msg.t > 1e12 ? Math.floor(msg.t / 1000) : msg.t;
    } else {
      const ms = Date.parse(msg.t);
      tsSec = Math.floor(ms / 1000);
    }

    const bar: RealTimeBar = {
      symbol: msg.S,
      timestamp: tsSec,
      open: msg.o,
      high: msg.h,
      low: msg.l,
      close: msg.c,
      volume: msg.v,
      vwap: msg.vw,
      tradeCount: msg.n
    };

    this.lastBarTimes.set(bar.symbol, tsSec);

    this.barCallbacks.forEach(cb => {
      try {
        cb(bar);
      } catch (e) {
        this.logger.error(`callback error ${(e as Error).message}`);
      }
    });
  }

  private handleClose(code: number, reason: Buffer): void {

    this.logger.warn(`🔌 Socket closed ${code} ${reason}`);

    this.lastSubscriptionsBeforeDisconnect = [...this.subscriptions];

    this.isAuthenticated = false;
    this.ws = null;

    if (!this.intentionalDisconnect) {
      this.scheduleReconnect();
    }
  }

  private handleError(err: Error): void {

    this.logger.error(`❌ WebSocket error ${err.message}`);

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.terminate();
      } catch {}
    }

    this.ws = null;

    if (!this.isReconnecting) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {

    if (!this.config.enabled) return;
    if (this.isReconnecting) return;

    this.isReconnecting = true;

    this.reconnectAttempts++;

    const delay = Math.min(
      this.config.reconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts - 1),
      60000
    );

    this.logger.log(`🔄 Reconnecting in ${delay / 1000}s`);

    this.reconnectTimeoutId = setTimeout(() => {

      this.isReconnecting = false;

      this.connect().catch(err => {
        this.logger.error(`Reconnect failed ${err.message}`);
        this.scheduleReconnect();
      });

    }, delay);
  }

  private startPing(): void {

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {

      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch {}
      }

    }, 30000);
  }
}