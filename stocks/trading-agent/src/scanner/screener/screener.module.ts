import { Module } from '@nestjs/common';
import { ScreenerService } from './screener.service';
import { ScreenerController } from './screener.controller';
import { RankingService } from './ranking/ranking.service';
import { AssetsService } from './assets/assets.service';
import { ScreenerRepository } from './persistence/screener.repository';
import { AlpacaScreenerClient } from './alpaca/alpaca-screener.client';
import { ActiveSymbolsService } from './active/active-symbols.service';
import { ScreenerCron } from './schedule/screener.cron';

@Module({
  providers: [
    ScreenerRepository,
    AlpacaScreenerClient,
    AssetsService,
    ActiveSymbolsService,
    RankingService,
    ScreenerService,
    ScreenerCron,
  ],
  controllers: [ScreenerController],
  exports: [ScreenerService, RankingService, ScreenerRepository],
})
export class ScreenerModule {}
