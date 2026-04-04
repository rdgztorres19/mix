import { Controller, Get, Param, Query } from '@nestjs/common';
import { ChartService } from './chart.service';

@Controller('chart')
export class ChartController {
  constructor(private readonly chartService: ChartService) {}

  @Get(':symbol/:date')
  async getCandles(
    @Param('symbol') symbol: string,
    @Param('date') date: string,
    @Query('tf') tf: '1m' | '5m' = '1m',
  ) {
    return this.chartService.getCandlesWithIndicators(symbol, date, tf);
  }

  @Get(':symbol/:date/news')
  async getNews(
    @Param('symbol') symbol: string,
    @Param('date') date: string,
  ) {
    return this.chartService.getNews(symbol, date);
  }
}
