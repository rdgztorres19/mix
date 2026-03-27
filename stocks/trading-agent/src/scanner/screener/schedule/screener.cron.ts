import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RankingService } from '../ranking/ranking.service';
import {
  isEtWeekday,
  isEtMarketRankingWindow,
  isEtPostMarketCacheWindow,
} from '../utils/et-time';

/**
 * Crons run in server TZ; guards use America/New_York for session windows.
 * Market: 09:00–12:59 ET Mon–Fri every minute (ranking + quotes).
 * Post-market: 16:00–20:00 ET at :00 each hour — refresh quote cache for full universe (Alpaca extended ~20:00 ET).
 */
@Injectable()
export class ScreenerCron {
  private readonly logger = new Logger(ScreenerCron.name);

  constructor(private readonly ranking: RankingService) {}

  //Execute every minute during market hours
  @Cron('*/1 * * * *')
  async marketTick(): Promise<void> {
    const now = new Date();
    if (!isEtWeekday(now) || !isEtMarketRankingWindow(now)) return;
    try {
      await this.ranking.syncAllRankings();
    } catch (e) {
      this.logger.error(`market screener sync failed: ${(e as Error).message}`);
    }
  }

  //Execute every hour during post-market hours
  @Cron('0 * * * *')
  async postMarketHourly(): Promise<void> {
    const now = new Date();
    if (!isEtWeekday(now) || !isEtPostMarketCacheWindow(now)) return;
    try {
      await this.ranking.refreshQuoteCacheOnly();
    } catch (e) {
      this.logger.error(`post-market quote refresh failed: ${(e as Error).message}`);
    }
  }
}
