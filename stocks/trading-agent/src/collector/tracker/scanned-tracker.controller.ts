import { Controller, Get } from '@nestjs/common';
import { ScannedTrackerService, ScannedSymbolData } from './scanned-tracker.service';

@Controller('scanner-tracker')
export class ScannedTrackerController {
  constructor(private readonly trackerService: ScannedTrackerService) {}

  @Get('today')
  getTrackedSymbolsToday(): ScannedSymbolData[] {
    return this.trackerService.getTrackedSymbols();
  }
}
