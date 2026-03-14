import { Controller, Post, Get, Optional, Body } from '@nestjs/common';
import { CollectorService } from './collector.service';
import { WebSocketInitService } from '../websocket/websocket-init.service';
import { PositionTrackerService } from '../trader/position-tracker.service';

@Controller('collector')
export class CollectorController {
  constructor(
    private readonly collector: CollectorService,
    @Optional() private readonly webSocketInit: WebSocketInitService | null,
    @Optional() private readonly positionTracker: PositionTrackerService | null,
  ) {}

  /**
   * POST /collector/sync-symbol-date
   * Fetches 1m bars from Alpaca for symbol+date, deletes existing rows,
   * builds training rows with unified features, bulk inserts.
   * Body: { symbol: string, date: string } (date YYYY-MM-DD)
   */
  @Post('sync-symbol-date')
  async syncSymbolDate(
    @Body() body: { symbol: string; date: string },
  ): Promise<{ ok: boolean; rows: number; error?: string }> {
    const { symbol, date } = body;
    if (!symbol || !date) {
      return { ok: false, rows: 0, error: 'symbol and date required' };
    }
    return this.collector.syncSymbolDate(symbol, date);
  }

  /**
   * POST /collector/sync-date
   * Syncs ALL symbols that exist in DB for the given date.
   * Fetches each from Alpaca, deletes existing rows, rebuilds with unified features.
   * Body: { date: string } (YYYY-MM-DD)
   */
  @Post('sync-date')
  async syncDate(
    @Body() body: { date: string },
  ): Promise<{ ok: boolean; symbols: number; totalRows: number; errors: string[] }> {
    const { date } = body;
    if (!date) {
      return { ok: false, symbols: 0, totalRows: 0, errors: ['date required'] };
    }
    return this.collector.syncDate(date);
  }

  /**
   * POST /collector/sync-today
   * Fetches top gainers from HPG or Alpaca screener, syncs each from Alpaca to MySQL.
   * Body: { source: 'hpg' | 'alpaca_screener' }
   */
  @Post('sync-today')
  async syncToday(
    @Body() body: { source?: 'hpg' | 'alpaca_screener' },
  ): Promise<{
    ok: boolean;
    symbols?: number;
    totalRows?: number;
    skipped?: boolean;
    reason?: string;
  }> {
    const source = body?.source ?? 'hpg';
    return this.collector.syncTodayFromSource(source);
  }

  /**
   * GET /collector/status
   * Debug endpoint: active symbols and MoMo subscription status.
   */
  @Get('status')
  async getStatus(): Promise<{
    activeSymbols: string[];
    subscribedSymbols: string[];
    wsConnected: boolean;
    symbolCount: number;
  }> {
    return this.collector.getDebugStatus();
  }

  /**
   * POST /collector/force-resync
   * Force re-subscription to all active symbols.
   */
  @Post('force-resync')
  async forceResync(): Promise<{ ok: boolean; resubscribed: string[] }> {
    return this.collector.forceResubscribeAll();
  }

  /**
   * POST /collector/test-scan
   * Manually trigger a MoMo scan.
   */
  @Post('test-scan')
  async testScan(): Promise<{ ok: boolean; newSymbols: string[] }> {
    const newSymbols = await this.collector.scanMomo();
    return { ok: true, newSymbols };
  }

  /**
   * GET /collector/websocket-stats
   * Debug endpoint: WebSocket data flow statistics.
   */
  @Get('websocket-stats')
  async getWebSocketStats() {
    return this.collector.getWebSocketStats();
  }

  /**
   * GET /collector/debug-streams
   * Debug endpoint: show status of both Alpaca and MoMo streams, positions, last bar times.
   */
  @Get('debug-streams')
  async getStreamStatus(): Promise<{
    alpaca: { connected: boolean; subscriptions: string[]; source: string };
    momo: { connected: boolean; subscriptions: string[]; source: string };
    activeSymbols: string[];
    primaryStream: string;
    positions: Array<{
      id: number;
      symbol: string;
      entry_time: string;
      entry_price: number;
      qty: number;
      entry_candle_idx: number;
      candles_elapsed: number;
      alpaca_order_id: string;
    }>;
    lastBarTimes: Record<string, number>;
  }> {
    const alpacaConnected = this.webSocketInit?.isAlpacaConnected() ?? false;
    const alpacaSubscriptions = this.webSocketInit?.getAlpacaSubscriptions() ?? [];
    const lastBarTimes = this.webSocketInit?.getLastBarTimesMap() ?? {};

    const momoConnected = this.collector['momoStream']?.isConnected() ?? false;
    const momoSubscriptions = this.collector['momoStream']?.getSubscribedSymbols() ?? [];

    const positions = this.positionTracker?.getAllOpen() ?? [];

    return {
      alpaca: {
        connected: alpacaConnected,
        subscriptions: alpacaSubscriptions,
        source: 'Premium SIP Feed'
      },
      momo: {
        connected: momoConnected,
        subscriptions: momoSubscriptions,
        source: 'MoMo Fallback'
      },
      activeSymbols: this.collector.getActiveSymbolList(),
      primaryStream: alpacaConnected ? 'Alpaca Premium' : 'MoMo Fallback',
      positions: positions.map(p => ({
        id: p.id,
        symbol: p.symbol,
        entry_time: p.entry_time,
        entry_price: p.entry_price,
        qty: p.qty,
        entry_candle_idx: p.entry_candle_idx,
        candles_elapsed: p.candles_elapsed,
        alpaca_order_id: p.alpaca_order_id,
      })),
      lastBarTimes,
    };
  }
}
