import { Controller, Get, Param } from '@nestjs/common';
import type { PredictionBundle } from '@small-caps/shared';
import { PredictorService } from './predictor.service';

@Controller('predictor')
export class PredictorController {
  constructor(private readonly service: PredictorService) {}

  @Get(':symbol/:date/:candleIdx')
  async getPredictions(
    @Param('symbol') symbol: string,
    @Param('date') date: string,
    @Param('candleIdx') candleIdx: string,
  ): Promise<PredictionBundle> {
    return this.service.predict(symbol, date, parseInt(candleIdx, 10));
  }
}
