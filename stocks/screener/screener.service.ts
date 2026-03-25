import { Injectable, Logger } from '@nestjs/common';
import { AlpacaBatchService } from './batch/alpaca-batch.service';
import { RankingService } from './ranking/ranking.service';
import { AssetsService } from './assets/assets.service';

@Injectable()
export class ScreenerService {
  private readonly logger = new Logger(ScreenerService.name);

  constructor(
    private readonly alpacaBatch: AlpacaBatchService,
    private readonly ranking: RankingService,
    private readonly assets: AssetsService,
  ) {}

  async getTopGappers() {
    return this.ranking.getTopGappers();
  }

  async getTopGainers() {
    return this.ranking.getTopGainers();
  }

  async getCombinedSymbols() {
    return this.ranking.getCombinedSymbols();
  }

  async forceSync() {
    this.logger.log('Manual force sync triggered');
    return this.ranking.syncAllRankings();
  }
}
