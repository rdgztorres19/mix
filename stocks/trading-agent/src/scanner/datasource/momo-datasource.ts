import { Injectable } from '@nestjs/common';
import { ScannerService } from '../scanner.service';
import type { IStockDataSource, StockSnapshotOptions } from './stock-datasource.interface';

/**
 * Live data from momoscreener API (today's data).
 */
@Injectable()
export class MomoDataSource implements IStockDataSource {
  constructor(private readonly scannerService: ScannerService) {}

  async getStockSnapshot(ticker: string, options?: StockSnapshotOptions) {
    return this.scannerService.getStockSnapshotFromMomo(
      ticker,
      options?.cutoffMs,
      options?.timeframe ?? '5m',
    );
  }
}
