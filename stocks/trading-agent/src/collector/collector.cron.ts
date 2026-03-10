/**
 * CollectorCron: scheduled jobs for the collector pipeline.
 *
 * - 8:00 AM ET (12:00 UTC): initial daily MoMo scan
 * - Every 30 minutes during market hours: refresh scan for new tickers
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CollectorService } from './collector.service';

@Injectable()
export class CollectorCron {
  private readonly logger = new Logger(CollectorCron.name);

  constructor(private readonly collector: CollectorService) {}

  /**
   * 8:00 AM ET = 12:00 UTC (winter) / 12:00 UTC (summer, DST).
   * Pre-market scan to seed the initial watchlist.
   */
  @Cron('0 12 * * 1-5')
  async runDailyScan(): Promise<void> {
    this.logger.log('⏰ Daily pre-market MoMo scan (8:00 AM ET)…');
    await this.collector.resetActiveSymbols();
    await this.collector.scanMomo();
  }

  /**
   * Every 5 minutes during 9:00–20:00 UTC (covers 4 AM – 4 PM ET).
   * Catches new movers that appear during the trading day.
   */
  @Cron('*/5 9-20 * * 1-5')
  async runPeriodicScan(): Promise<void> {
    this.logger.log('🔄 Periodic MoMo scan…');
    await this.collector.scanMomo();
  }

  /**
   * Every 5 minutes during market hours: refresh candles from MoMo
   * to fill gaps that Alpaca IEX free tier misses.
   */
  @Cron('*/5 13-21 * * 1-5')
  async runMomoRefresh(): Promise<void> {
    this.logger.log('🕐 MoMo candle refresh (filling IEX gaps)…');
    await this.collector.refreshAllFromMomo();
  }
}
