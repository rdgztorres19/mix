import { Injectable, Logger } from '@nestjs/common';
import { RankingService } from './ranking/ranking.service';

@Injectable()
export class ScreenerService {
  private readonly logger = new Logger(ScreenerService.name);

  constructor(private readonly ranking: RankingService) {}

  async getTopGappers() {
    return this.ranking.getTopGappers();
  }

  async getTopGainers() {
    return this.ranking.getTopGainers();
  }

  async getGainersDetailed() {
    const [session, intraday] = await Promise.all([
      this.ranking.getTopGainersSession(),
      this.ranking.getTopGainersIntraday(),
    ]);
    return { session, intraday };
  }

  async getTopHighs() {
    return this.ranking.getTopHighs();
  }

  async getActiveSymbols() {
    return this.ranking.getCombinedSymbols();
  }

  async getActiveDetailed() {
    return this.ranking.getActiveRows();
  }

  async getStatus() {
    return this.ranking.getStatus();
  }

  async getCombinedSymbols() {
    return this.ranking.getCombinedSymbols();
  }

  async forceSync() {
    this.logger.log('Manual force sync triggered');
    return this.ranking.syncAllRankings();
  }
}
