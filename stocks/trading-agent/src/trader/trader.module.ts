import { Module } from '@nestjs/common';
import { ScannerModule } from '../scanner/scanner.module';
import { PredictorModule } from '../predictor/predictor.module';
import { AlpacaTraderService } from './alpaca-trader.service';
import { PositionTrackerService } from './position-tracker.service';
import { AutoTraderService } from './auto-trader.service';

@Module({
  imports: [ScannerModule, PredictorModule],
  providers: [
    AlpacaTraderService,
    PositionTrackerService,
    AutoTraderService,
  ],
  exports: [AutoTraderService],
})
export class TraderModule {}
