import type { StockSnapshot } from '../scanner.service';
export interface StockSnapshotOptions {
    cutoffMs?: number;
    timeframe?: '1m' | '5m';
    date?: string;
}
export interface IStockDataSource {
    getStockSnapshot(ticker: string, options?: StockSnapshotOptions): Promise<StockSnapshot>;
}
