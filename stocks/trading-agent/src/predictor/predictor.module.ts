import { Module } from '@nestjs/common';
import { PredictorService } from './predictor.service';
import { PredictorController } from './predictor.controller';

@Module({
  providers: [PredictorService],
  controllers: [PredictorController],
  exports: [PredictorService],
})
export class PredictorModule {}
