import { Module } from '@nestjs/common';
import { ScreenerService } from './screener.service';
import { ScreenerController } from './screener.controller';
import { AlpacaBatchService } from './batch/alpaca-batch.service';
import { RankingService } from './ranking/ranking.service';
import { AssetsService } from './assets/assets.service';

@Module({
  providers: [ScreenerService, AlpacaBatchService, RankingService, AssetsService],
  controllers: [ScreenerController],
  exports: [ScreenerService, RankingService],
})
export class ScreenerModule {}
