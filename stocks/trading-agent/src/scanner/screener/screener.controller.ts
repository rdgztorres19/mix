import { Controller, Get, Post, HttpCode } from '@nestjs/common';
import { ScreenerService } from './screener.service';

@Controller('screener')
export class ScreenerController {
  constructor(private readonly screenerService: ScreenerService) {}

  @Get('gappers')
  getGappers() {
    return this.screenerService.getTopGappers();
  }

  @Get('gainers')
  getGainers() {
    return this.screenerService.getGainersDetailed();
  }

  @Get('gainers/session')
  getGainersSession() {
    return this.screenerService.getTopGainers();
  }

  @Get('combined')
  getCombined() {
    return this.screenerService.getCombinedSymbols();
  }

  @Get(['active', 'active-symbols'])
  getActive() {
    return this.screenerService.getActiveDetailed();
  }

  @Get('highs')
  getHighs() {
    return this.screenerService.getTopHighs();
  }

  @Get('status')
  getStatus() {
    return this.screenerService.getStatus();
  }

  @Post('force-sync')
  @HttpCode(200)
  async forceSync() {
    return this.screenerService.forceSync();
  }
}
