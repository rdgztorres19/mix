import { Module } from '@nestjs/common';
import { PredictorService } from './predictor.service';
import { PredictorController } from './predictor.controller';
import { ScannerModule } from '../scanner/scanner.module';

@Module({
  imports: [ScannerModule],
  providers: [PredictorService],
  controllers: [PredictorController],
  exports: [PredictorService],
})
export class PredictorModule {}
