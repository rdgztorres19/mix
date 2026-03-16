import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AlpacaWebSocketService } from './alpaca-websocket.service';
import { AlpacaDataSource } from '../scanner/datasource/alpaca-datasource';
import type { CollectorService } from '../collector/collector.service';

/**
 * WebSocket Fallback Cron - monitors WebSocket health and triggers API fallback.
 * Runs every 61 seconds to check if WebSocket received data in the last minute.
 * If not, fetches missing bars via Alpaca REST API.
 */
@Injectable()
export class WebSocketFallbackCron {
  private readonly logger = new Logger(WebSocketFallbackCron.name);
  private readonly enabled: boolean;
  private readonly symbols: string[];
  private readonly checkIntervalSeconds = 61; // Check every 61 seconds

  constructor(
    private readonly configService: ConfigService,
    private readonly alpacaWebSocket: AlpacaWebSocketService,
    private readonly alpacaDataSource: AlpacaDataSource,
    @Optional() @Inject('COLLECTOR_SERVICE') private readonly collector?: CollectorService,
  ) {
    this.enabled = configService.get<boolean>('WEBSOCKET_FALLBACK_ENABLED', true);
    this.symbols = configService.get<string>('ALPACA_WEBSOCKET_SYMBOLS', 'ACXP')
      .split(',')
      .map(s => s.trim());

    this.logger.log(`🔍 WebSocket Fallback Cron initialized - uses dynamic symbols from CollectorService`);
  }

  /**
   * Runs every 61 seconds (1 second after each minute ends).
   * When WebSocket connected: check if bars received; if missing, fetch via REST.
   * When WebSocket disconnected: fetch bars for all active symbols via REST (historical fallback).
   */
  @Cron('1,5 * * * * *', { name: 'websocket-fallback-check' })
  async checkWebSocketHealth(): Promise<void> {
    if (!this.enabled || !this.collector) return;

    const symbols = this.collector.getSymbolsList();
    if (symbols.length === 0) return;

    const now = Math.floor(Date.now() / 1000);
    const expectedBarTime = this.getExpectedBarTime(now);

    if (!this.alpacaWebSocket.isConnected()) {
      this.alpacaWebSocket.triggerReconnectIfDisconnected();
      this.logger.log(`🔌 WebSocket disconnected - fetching fallback for ${symbols.length} symbols via REST`);
      for (const symbol of symbols) {
        await this.fetchFallbackData(symbol, expectedBarTime);
      }
      return;
    }

    for (const symbol of symbols) {
      await this.checkSymbolData(symbol, expectedBarTime);
    }
  }

  /** Normalize timestamp to unix seconds (handles number seconds, number ms, or ISO string) */
  private toUnixSeconds(v: number | string | null | undefined): number | null {
    if (v == null) return null;
    if (typeof v === 'number') {
      return v > 1e12 ? Math.floor(v / 1000) : v;
    }
    const parsed = Date.parse(String(v));
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }

  private async checkSymbolData(symbol: string, expectedBarTime: number): Promise<void> {
    const raw = this.alpacaWebSocket.getLastBarTime(symbol);
    const lastBarTimeSec = this.toUnixSeconds(raw);

    // Check if we received data for the expected minute (30 second tolerance)
    const isDataMissing = lastBarTimeSec == null || Math.abs(lastBarTimeSec - expectedBarTime) > 30;

    if (isDataMissing) {
      this.logger.warn(`⚠️ Missing WebSocket data for ${symbol} at ${new Date(expectedBarTime * 1000).toISOString()}`);
      await this.fetchFallbackData(symbol, expectedBarTime);
    } else {
      //this.logger.debug(`✅ WebSocket data OK for ${symbol}`);
    }
  }

  private async fetchFallbackData(symbol: string, barTime: number): Promise<void> {
    try {
      // Fetch a small 1-minute window [barTime, barTime+60s) to increase chance of a bar
      const startDate = new Date(barTime * 1000);
      const endDate = new Date((barTime + 60) * 1000);
      const startTime = startDate.toISOString().slice(0, 19) + 'Z';
      const endTime = endDate.toISOString().slice(0, 19) + 'Z';

      this.logger.log(`🔄 Fetching fallback data for ${symbol}: ${startTime}`);

      // Use AlpacaDataSource to fetch the missing bar
      const response = await this.alpacaDataSource.fetchBarsFromAlpacaDirect({
        symbol,
        timeframe: '1Min',
        start: startTime,
        end: endTime,
        feed: 'sip',
        limit: 1
      });

      if (response && response.bars && response.bars[symbol] && response.bars[symbol].length > 0) {
        const bar: any = response.bars[symbol][0];
        this.logger.log(`✅ Fallback data retrieved for ${symbol}: $${bar.c} (Vol: ${bar.v})`);

        // Normalize timestamp to ms (supports unix seconds or ISO string)
        let tsMs: number | null = null;
        if (typeof bar.t === 'number') {
          tsMs = Number.isFinite(bar.t) ? bar.t * 1000 : null;
        } else if (typeof bar.t === 'string') {
          const parsed = Date.parse(bar.t);
          tsMs = Number.isNaN(parsed) ? null : parsed;
        }

        if (!Number.isFinite(tsMs as number)) {
          this.logger.warn(`⚠️ Fallback bar has invalid timestamp for ${symbol}: ${JSON.stringify(bar)}`);
          return;
        }

        // If CollectorService is available, process this bar as a closed candle
        if (this.collector) {
          await this.collector.onCandleClosed(symbol, {
            o: bar.o,
            h: bar.h,
            l: bar.l,
            c: bar.c,
            v: bar.v,
            t: tsMs as number,
          });
          this.logger.log(`📡 Fallback bar forwarded to collector for ${symbol} at ${new Date(tsMs as number).toISOString()}`);
        } else {
          this.logger.warn('⚠️ CollectorService not available - cannot forward fallback bar');
        }
      } else {
        this.logger.warn(`⚠️ No fallback data available for ${symbol} at ${startTime}`);
        const fallbackUrl = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?feed=sip&timeframe=1Min&start=${startTime}&end=${endTime}&limit=1`;
        this.logger.warn(`   URL: ${fallbackUrl}`);
      }

    } catch (error) {
      this.logger.error(`❌ Fallback fetch failed for ${symbol}:`, error.message);
    }
  }

  /**
   * Calculate the expected bar time for the previous completed minute.
   * Example: if now is 16:48:37, expected bar time is 16:47:00
   */
  private getExpectedBarTime(currentUnixTime: number): number {
    const currentDate = new Date(currentUnixTime * 1000);

    // Get the previous completed minute
    const expectedDate = new Date(currentDate);
    expectedDate.setMinutes(expectedDate.getMinutes() - 1);
    expectedDate.setSeconds(0);
    expectedDate.setMilliseconds(0);

    return Math.floor(expectedDate.getTime() / 1000);
  }

  /**
   * Manual trigger for testing fallback functionality
   */
  async triggerFallbackCheck(): Promise<void> {
    this.logger.log('🔧 Manual fallback check triggered');
    await this.checkWebSocketHealth();
  }
}

// Add method to AlpacaDataSource for direct API calls (needed by fallback)
declare module '../scanner/datasource/alpaca-datasource' {
  interface AlpacaDataSource {
    fetchBarsFromAlpacaDirect(params: {
      symbol: string;
      timeframe: string;
      start: string;
      end: string;
      feed: string;
      limit: number;
    }): Promise<any>;
  }
}