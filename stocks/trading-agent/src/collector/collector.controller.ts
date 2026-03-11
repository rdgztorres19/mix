import { Controller, Post, Get } from '@nestjs/common';
import { CollectorService } from './collector.service';

@Controller('collector')
export class CollectorController {
  constructor(private readonly collector: CollectorService) {}

  /**
   * POST /collector/sync-today
   * Triggers a MoMo refresh for today's candles (skips after hours).
   */
  @Post('sync-today')
  async syncToday(): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
    const result = await this.collector.refreshAllFromMomo({ force: true });
    return { ok: true, ...result };
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
   * Debug endpoint: show status of both Alpaca and MoMo streams.
   */
  @Get('debug-streams')
  async getStreamStatus(): Promise<{
    alpaca: { connected: boolean; subscriptions: string[]; source: string };
    momo: { connected: boolean; subscriptions: string[]; source: string };
    activeSymbols: string[];
    primaryStream: string;
  }> {
    const alpacaConnected = this.collector['webSocketInit']?.isAlpacaConnected() ?? false;
    const alpacaSubscriptions = alpacaConnected ? 
      Array.from((this.collector['webSocketInit']?.['alpacaWebSocket'] as any)?.subscriptions || []) as string[] : [];
    
    const momoConnected = this.collector['momoStream']?.isConnected() ?? false;
    const momoSubscriptions = this.collector['momoStream']?.getSubscribedSymbols() ?? [];
    
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
      primaryStream: alpacaConnected ? 'Alpaca Premium' : 'MoMo Fallback'
    };
  }
}
