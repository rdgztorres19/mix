import { Module } from '@nestjs/common';
import { ScannerModule } from '../scanner/scanner.module';
import { PredictorModule } from '../predictor/predictor.module';
import { CacheModule } from '../cache/cache.module';
import { AlpacaTraderService } from './alpaca-trader.service';
import { PositionTrackerService } from './position-tracker.service';
import { AutoTraderService } from './auto-trader.service';

@Module({
  imports: [ScannerModule, PredictorModule, CacheModule],
  providers: [
    AlpacaTraderService,
    PositionTrackerService,
    AutoTraderService,
  ],
  exports: [AutoTraderService, PositionTrackerService],
})
export class TraderModule {}
