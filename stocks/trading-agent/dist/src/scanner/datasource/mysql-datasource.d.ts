import { MysqlTrainingRepository } from '../mysql/mysql-training.repository';
import type { StockSnapshot } from '../scanner.service';
import type { IStockDataSource } from './stock-datasource.interface';
export declare class MysqlDataSource implements IStockDataSource {
    private readonly mysqlRepo;
    private readonly logger;
    constructor(mysqlRepo: MysqlTrainingRepository);
    getStockSnapshot(ticker: string, options?: {
        cutoffMs?: number;
        timeframe?: '1m' | '5m';
        date?: string;
    }): Promise<StockSnapshot>;
    private rowsToCandles;
    private aggregate1mTo5m;
    private estimateAvgFromRows;
    getAvailableDates(): Promise<string[]>;
    private emptySnapshot;
}
