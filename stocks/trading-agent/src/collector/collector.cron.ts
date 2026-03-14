/**
 * CollectorCron: scheduled jobs for the collector pipeline.
 *
 * - Every 1 minute during market hours (9:30–16:00 ET ≈ 14:30–21:00 UTC):
 *   Fetch top gainers from TOP_GAINERS_SOURCE (HPG or Alpaca), replace activeSymbols,
 *   add new symbols to collection, refresh Alpaca WebSocket subscriptions.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CollectorService } from './collector.service';

@Injectable()
export class CollectorCron {
  private readonly logger = new Logger(CollectorCron.name);

  constructor(private readonly collector: CollectorService) {}

  /**
   * Every minute during market hours (9:30–16:00 ET ≈ 14:30–21:00 UTC).
   * Fetch top gainers from env source, replace activeSymbols, add new to symbols.
   */
  @Cron('0 * 14-21 * * 1-5')
  async runTopGainersCron(): Promise<void> {
    this.logger.log('⏰ Top gainers cron (1 min)…');
    await this.collector.runTopGainersCron();
  }
}
