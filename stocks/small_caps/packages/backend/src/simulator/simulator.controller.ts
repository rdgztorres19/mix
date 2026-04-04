import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { SimulatorService } from './simulator.service';

@Controller('simulator')
export class SimulatorController {
  constructor(private readonly simulatorService: SimulatorService) {}

  @Get(':symbol/:date/:candleIdx')
  async getState(
    @Param('symbol') symbol: string,
    @Param('date') date: string,
    @Param('candleIdx', ParseIntPipe) candleIdx: number,
    @Query('source') source?: string,
  ) {
    return this.simulatorService.getSimulationState(symbol, date, candleIdx, source);
  }
}
