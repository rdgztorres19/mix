import { Controller, Get, Param } from '@nestjs/common';
import { ScreenerService } from './screener.service';

@Controller('screener')
export class ScreenerController {
  constructor(private readonly screenerService: ScreenerService) {}

  @Get('dates')
  async getDates() {
    return this.screenerService.getAvailableDates();
  }

  /** Returns symbols already in DB for this date (pre-computed during sync). */
  @Get('stocks/:date')
  async getStocksForDate(@Param('date') date: string) {
    return this.screenerService.getStocksForDate(date);
  }

  /** Full screener computation (used by sync and future real-time). */
  @Get('compute/:date')
  async getScreener(@Param('date') date: string) {
    return this.screenerService.getScreener(date);
  }
}
