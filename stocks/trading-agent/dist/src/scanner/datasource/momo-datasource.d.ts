import { ScannerService } from '../scanner.service';
import type { IStockDataSource, StockSnapshotOptions } from './stock-datasource.interface';
export declare class MomoDataSource implements IStockDataSource {
    private readonly scannerService;
    constructor(scannerService: ScannerService);
    getStockSnapshot(ticker: string, options?: StockSnapshotOptions): Promise<import("../scanner.service").StockSnapshot>;
}
