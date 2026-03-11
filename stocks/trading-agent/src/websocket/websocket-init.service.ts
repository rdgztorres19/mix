import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject, forwardRef } from '@nestjs/common';
import { AlpacaWebSocketService } from './alpaca-websocket.service';
import { CollectorService } from '../collector/collector.service';
import type { CollectorCandle } from '../collector/indicator.calculator';

/**
 * WebSocket initializer - starts WebSocket connection on module initialization.
 * Coordinates with CollectorService to subscribe to active symbols dynamically.
 */
@Injectable()
export class WebSocketInitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebSocketInitService.name);

  constructor(
    private readonly alpacaWebSocket: AlpacaWebSocketService,
    @Inject(forwardRef(() => CollectorService))
    private readonly collector: CollectorService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('🚀 Initializing Alpaca WebSocket connection...');

    // Register before connect so callback runs on first auth and every reconnect
    this.alpacaWebSocket.onAuthenticated(async () => {
      const activeSymbols = this.collector.getActiveSymbolList();
      if (activeSymbols.length > 0) {
        this.logger.log(`🔄 Post-auth: refreshing subscriptions for ${activeSymbols.length} active symbols: [${activeSymbols.join(', ')}]`);
        await this.refreshSubscriptions(activeSymbols);
      }
    });
    
    try {
      await this.alpacaWebSocket.connect();

      // Register callback for received 1-min bars from Alpaca
      this.alpacaWebSocket.onBar(async (bar) => {
        // Convert Alpaca unix-seconds timestamp to ms
        const tsMs = typeof bar.timestamp === 'number'
          ? bar.timestamp * 1000
          : Number.isFinite(Date.parse(String(bar.timestamp)))
            ? Date.parse(String(bar.timestamp))
            : NaN;

        if (!Number.isFinite(tsMs)) {
          this.logger.warn(`⚠️ Skipping bar with invalid timestamp for ${bar.symbol}: ${JSON.stringify(bar)}`);
          return;
        }

        const candle: CollectorCandle = {
          o: bar.open,
          h: bar.high,
          l: bar.low,
          c: bar.close,
          v: bar.volume,
          t: tsMs,
        };

        this.logger.log(
          `📊 Real-time bar → collector: ${bar.symbol} close=${bar.close} vol=${bar.volume} ts=${new Date(tsMs).toISOString()}`,
        );

        try {
          await this.collector.onCandleClosed(bar.symbol, candle);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.error(`❌ Failed to process real-time bar for ${bar.symbol}: ${msg}`);
        }
      });

      // Wait a moment for WebSocket to authenticate
      await new Promise(resolve => setTimeout(resolve, 2000));

      this.logger.log('🔗 WebSocket ready for dynamic subscriptions');
      
    } catch (error) {
      this.logger.error('❌ Failed to initialize WebSocket:', error.message);
    }
  }

  /**
   * Subscribe to symbols dynamically (called by CollectorService).
   */
  async subscribeToSymbols(symbols: string[]): Promise<void> {
    if (symbols.length === 0) return;
    
    this.logger.log(`🎯 Updating Alpaca WebSocket subscriptions: [${symbols.join(', ')}]`);
    
    try {
      await this.alpacaWebSocket.subscribe(symbols);
    } catch (error) {
      this.logger.error(`❌ Failed to subscribe to symbols: ${error.message}`);
    }
  }

  /**
   * Unsubscribe from symbols.
   */
  async unsubscribeFromSymbols(symbols: string[]): Promise<void> {
    if (symbols.length === 0) return;
    
    this.logger.log(`🚫 Removing Alpaca WebSocket subscriptions: [${symbols.join(', ')}]`);
    
    try {
      await this.alpacaWebSocket.unsubscribe(symbols);
    } catch (error) {
      this.logger.error(`❌ Failed to unsubscribe from symbols: ${error.message}`);
    }
  }

  /**
   * Check if Alpaca WebSocket is connected and active.
   */
  isAlpacaConnected(): boolean {
    return this.alpacaWebSocket.isConnected();
  }

  /**
   * Refresh subscriptions based on provided active symbols.
   * Called by CollectorService when symbols change.
   */
  async refreshSubscriptions(activeSymbols: string[]): Promise<void> {
    this.logger.log(`🔄 Refreshing Alpaca WebSocket subscriptions for ${activeSymbols.length} active symbols...`);
    
    // Get current subscriptions from AlpacaWebSocketService
    const currentSubscriptions = Array.from((this.alpacaWebSocket as any).subscriptions || []) as string[];
    
    // Unsubscribe from symbols no longer active
    const toUnsubscribe = currentSubscriptions.filter(symbol => !activeSymbols.includes(symbol));
    if (toUnsubscribe.length > 0) {
      this.logger.log(`🚫 Removing ${toUnsubscribe.length} inactive subscriptions: [${toUnsubscribe.join(', ')}]`);
      await this.unsubscribeFromSymbols(toUnsubscribe);
    }

    // Subscribe to new active symbols
    const toSubscribe = activeSymbols.filter(symbol => !currentSubscriptions.includes(symbol));
    if (toSubscribe.length > 0) {
      this.logger.log(`📈 Adding ${toSubscribe.length} new subscriptions: [${toSubscribe.join(', ')}]`);
      await this.subscribeToSymbols(toSubscribe);
    }

    if (toUnsubscribe.length === 0 && toSubscribe.length === 0) {
      this.logger.log('✅ Subscriptions already up-to-date');
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('👋 Shutting down WebSocket connections...');
    await this.alpacaWebSocket.disconnect();
  }
}