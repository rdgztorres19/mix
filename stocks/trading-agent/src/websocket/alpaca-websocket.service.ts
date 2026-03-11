import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import type { IWebSocketDataSource, RealTimeBar, WebSocketConfig } from './websocket.interface';

interface AlpacaWebSocketMessage {
  T: string; // message type
  msg?: string;
  S?: string; // symbol
  t?: number; // timestamp (unix seconds)
  o?: number; // open
  h?: number; // high
  l?: number; // low
  c?: number; // close
  v?: number; // volume
  vw?: number; // vwap
  n?: number; // trade count
}

/**
 * Alpaca Premium SIP WebSocket service for real-time 1-minute bars.
 * Handles authentication, subscription, reconnection, and fallback detection.
 */
@Injectable()
export class AlpacaWebSocketService implements IWebSocketDataSource {
  private readonly logger = new Logger(AlpacaWebSocketService.name);
  
  private ws: WebSocket | null = null;
  private isAuthenticated = false;
  private subscriptions = new Set<string>();
  private readonly barCallbacks: Array<(bar: RealTimeBar) => void> = [];
  
  // Track last received bar time for each symbol (for fallback detection)
  private readonly lastBarTimes = new Map<string, number>();
  
  private readonly config: WebSocketConfig;
  private readonly alpacaKeyId: string;
  private readonly alpacaSecretKey: string;
  private readonly wsUrl = 'wss://stream.data.alpaca.markets/v2/sip';

  constructor(private readonly configService: ConfigService) {
    this.alpacaKeyId = configService.get<string>('ALPACA_KEY_ID', 'PKBLVB6V5QWCSU2TLPHJ') || 'PKBLVB6V5QWCSU2TLPHJ';
    this.alpacaSecretKey = configService.get<string>('ALPACA_SECRET_KEY', 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG') || 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG';
    
    this.config = {
      enabled: configService.get<boolean>('ALPACA_WEBSOCKET_ENABLED', true),
      reconnectIntervalMs: configService.get<number>('ALPACA_RECONNECT_INTERVAL_MS', 5000),
      symbols: [], // Initialize empty - will be populated dynamically by CollectorService
    };

    this.logger.log(`🚀 Alpaca WebSocket initialized (dynamic subscriptions)`);
  }

  async connect(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.warn('⚠️ Alpaca WebSocket disabled in config');
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.logger.warn('🔗 WebSocket already connected');
      return;
    }

    this.logger.log('📡 Connecting to Alpaca Premium SIP WebSocket...');
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on('open', () => this.handleOpen());
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('close', (code, reason) => this.handleClose(code, reason));
    this.ws.on('error', (error) => this.handleError(error));
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.logger.log('👋 Disconnecting WebSocket...');
      this.ws.close();
      this.ws = null;
      this.isAuthenticated = false;
      this.subscriptions.clear();
    }
  }

  async subscribe(symbols: string[]): Promise<void> {
    if (!this.isAuthenticated) {
      this.logger.warn('⚠️ Cannot subscribe - not authenticated');
      return;
    }

    const newSymbols = symbols.filter(s => !this.subscriptions.has(s));
    if (newSymbols.length === 0) {
      return;
    }

    const subscribeMessage = {
      action: 'subscribe',
      bars: newSymbols
    };

    this.logger.log(`📊 Subscribing to bars: [${newSymbols.join(', ')}]`);
    this.ws?.send(JSON.stringify(subscribeMessage));

    newSymbols.forEach(symbol => this.subscriptions.add(symbol));
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    if (!this.isAuthenticated) return;

    const existingSymbols = symbols.filter(s => this.subscriptions.has(s));
    if (existingSymbols.length === 0) return;

    const unsubscribeMessage = {
      action: 'unsubscribe',
      bars: existingSymbols
    };

    this.logger.log(`📊 Unsubscribing from bars: [${existingSymbols.join(', ')}]`);
    this.ws?.send(JSON.stringify(unsubscribeMessage));

    existingSymbols.forEach(symbol => this.subscriptions.delete(symbol));
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && this.isAuthenticated;
  }

  getLastBarTime(symbol: string): number | null {
    return this.lastBarTimes.get(symbol) || null;
  }

  onBar(callback: (bar: RealTimeBar) => void): void {
    this.barCallbacks.push(callback);
  }

  private handleOpen(): void {
    this.logger.log('✅ WebSocket connected - authenticating...');
    
    const authMessage = {
      action: 'auth',
      key: this.alpacaKeyId,
      secret: this.alpacaSecretKey
    };

    this.ws?.send(JSON.stringify(authMessage));
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
            this.logger.log('📋 Subscription confirmed:', msg);
            break;
          case 'b': // bar message
            this.handleBar(msg);
            break;
          case 'error':
            this.logger.error('❌ Server error:', msg);
            break;
        }
      });

    } catch (error) {
      this.logger.error('❌ Error parsing WebSocket message:', error.message);
    }
  }

  private async handleAuthenticated(): Promise<void> {
    this.logger.log('🎉 Authentication successful - Ready for dynamic subscriptions');
    this.isAuthenticated = true;
    
    // Note: No auto-subscription to static symbols
    // Dynamic subscriptions will be managed by WebSocketInitService
  }

  private handleBar(msg: AlpacaWebSocketMessage): void {
    // Debug: log the raw message to understand actual format
    this.logger.debug(`📥 Raw bar message: ${JSON.stringify(msg)}`);
    
    if (!msg.S || !msg.t || msg.o == null || msg.h == null || msg.l == null || msg.c == null || msg.v == null) {
      this.logger.warn(`⚠️ Incomplete bar data received for ${msg.S}:`, {
        symbol: msg.S,
        timestamp: msg.t,
        hasOHLC: { o: msg.o !== undefined, h: msg.h !== undefined, l: msg.l !== undefined, c: msg.c !== undefined },
        volume: msg.v
      });
      return;
    }

    const bar: RealTimeBar = {
      symbol: msg.S,
      timestamp: msg.t,
      open: msg.o,
      high: msg.h,
      low: msg.l,
      close: msg.c,
      volume: msg.v,
      vwap: msg.vw,
      tradeCount: msg.n
    };

    // Update last bar time for fallback detection
    this.lastBarTimes.set(bar.symbol, bar.timestamp);

    // Validate timestamp before logging
    let timestampStr = 'Invalid Date';
    if (typeof bar.timestamp === 'number' && bar.timestamp > 0) {
      try {
        timestampStr = new Date(bar.timestamp * 1000).toLocaleTimeString();
      } catch (error) {
        timestampStr = `Invalid (${bar.timestamp})`;
      }
    } else {
      timestampStr = `Invalid (${bar.timestamp})`;
    }

    const change = ((bar.close - bar.open) / bar.open * 100).toFixed(2);
    const emoji = parseFloat(change) >= 0 ? '📈' : '📉';

    this.logger.log(`
📊 1-MIN BAR ${bar.symbol}
⏰ ${timestampStr}
🟢 Open: $${bar.open} | 🔴 High: $${bar.high} | 🟡 Low: $${bar.low} | ⚫ Close: $${bar.close}
📦 Volume: ${bar.volume} ${emoji} ${change}%
    `);

    // Notify all registered callbacks
    this.barCallbacks.forEach(callback => {
      try {
        callback(bar);
      } catch (error) {
        this.logger.error('❌ Error in bar callback:', error.message);
      }
    });
  }

  private handleClose(code: number, reason: Buffer): void {
    this.logger.warn(`🔌 WebSocket closed - Code: ${code}, Reason: ${reason}`);
    this.isAuthenticated = false;
    this.subscriptions.clear();

    // Reconnect after configured interval
    setTimeout(() => {
      this.logger.log('🔄 Attempting to reconnect...');
      this.connect().catch(error => {
        this.logger.error('❌ Reconnection failed:', error.message);
      });
    }, this.config.reconnectIntervalMs);
  }

  private handleError(error: Error): void {
    this.logger.error('❌ WebSocket error:', error.message);
  }
}