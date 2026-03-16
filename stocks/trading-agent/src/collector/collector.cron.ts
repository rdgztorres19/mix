/**
 * CollectorCron: scheduled jobs for the collector pipeline.
 *
 * - Every 1 minute during market hours (9:30–16:00 ET ≈ 14:30–21:00 UTC):
 *   Fetch top gainers from TOP_GAINERS_SOURCE (HPG or Alpaca), replace activeSymbols,
 *   add new symbols to collection, refresh Alpaca WebSocket subscriptions.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CollectorService } from './collector.service';

@Injectable()
export class CollectorCron implements OnModuleInit {
  private readonly logger = new Logger(CollectorCron.name);

  constructor(private readonly collector: CollectorService) {}

  async onModuleInit() {
    this.logger.log('🚀 Executing initial Top gainers fetch on startup...');
    await this.collector.runTopGainersCron();
  }

  /**
   * Every minute during market hours (9:30–16:00 ET).
   * Fetch top gainers from env source, replace activeSymbols, add new to symbols.
   */
  @Cron('0 * 9-16 * * 1-5', { timeZone: 'America/New_York' })
  async runTopGainersCron(): Promise<void> {
    this.logger.log('⏰ Top gainers cron (1 min)…');
    await this.collector.runTopGainersCron();
  }
}
