import type { StockSnapshot } from '../scanner.service';

export interface StockSnapshotOptions {
  cutoffMs?: number;
  timeframe?: '1m' | '5m';
  date?: string; // YYYY-MM-DD, required for historical (MySQL)
}

/**
 * Abstraction: data source for stock snapshots (live or historical).
 */
export interface IStockDataSource {
  getStockSnapshot(ticker: string, options?: StockSnapshotOptions): Promise<StockSnapshot>;
}
