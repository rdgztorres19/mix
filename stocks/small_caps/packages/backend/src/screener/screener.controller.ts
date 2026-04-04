import { Controller, Get, Param } from '@nestjs/common';
import { ScreenerService } from './screener.service';

@Controller('screener')
export class ScreenerController {
  constructor(private readonly screenerService: ScreenerService) {}

  @Get('dates')
  async getDates() {
    return this.screenerService.getAvailableDates();
  }

  @Get(':date')
  async getScreener(@Param('date') date: string) {
    return this.screenerService.getScreener(date);
  }
}
