import { ConfigService } from '@nestjs/config';
import type { IStockDataSource, StockSnapshotOptions } from './stock-datasource.interface';
import type { StockSnapshot } from '../scanner.service';
export declare class AlpacaDataSource implements IStockDataSource {
    private readonly configService;
    private readonly logger;
    private readonly alpacaKeyId;
    private readonly alpacaSecretKey;
    private readonly alpacaBaseUrl;
    private readonly maxRetries;
    private readonly requestTimeoutMs;
    private readonly cache;
    constructor(configService: ConfigService);
    getStockSnapshot(ticker: string, options?: StockSnapshotOptions): Promise<StockSnapshot>;
    private fetchBarWithRetries;
    private fetchBarsFromAlpaca;
    private aggregate1mTo5m;
    private estimateAvgVolume;
    private parseAlpacaTimestamp;
    private getTodayET;
    private emptySnapshot;
    clearCache(): void;
    fetch1mBarsForDate(symbol: string, dateStr: string): Promise<Array<{
        o: number;
        h: number;
        l: number;
        c: number;
        v: number;
        t: number;
    }>>;
}
