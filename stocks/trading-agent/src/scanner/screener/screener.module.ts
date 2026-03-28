import { Module } from '@nestjs/common';
import { CacheModule } from '../../cache/cache.module';
import { ScreenerService } from './screener.service';
import { ScreenerController } from './screener.controller';
import { RankingService } from './ranking/ranking.service';
import { AssetsService } from './assets/assets.service';
import { ScreenerRepository } from './persistence/screener.repository';
import { AlpacaScreenerClient } from './alpaca/alpaca-screener.client';
import { ActiveSymbolsService } from './active/active-symbols.service';
import { ScreenerCron } from './schedule/screener.cron';

@Module({
  imports: [CacheModule],
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
