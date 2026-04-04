import { Module } from '@nestjs/common';
import { ChartModule } from '../chart/chart.module';
import { DatabaseModule } from '../database/database.module';
import { PredictorController } from './predictor.controller';
import { PredictorService } from './predictor.service';

@Module({
  imports: [ChartModule, DatabaseModule],
  controllers: [PredictorController],
  providers: [PredictorService],
  exports: [PredictorService],
})
export class PredictorModule {}
