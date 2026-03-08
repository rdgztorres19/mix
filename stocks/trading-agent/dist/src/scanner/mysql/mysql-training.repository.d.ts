export declare class MysqlTrainingRepository {
    private readonly logger;
    private pool;
    private getPool;
    getAvailableDates(): Promise<string[]>;
    getTickerRows(ticker: string, resolution: '1m' | '5m'): Promise<Record<string, unknown>[]>;
    getTopMovers(dateStr: string): Promise<{
        symbol: string;
        change_pct: number;
        close: number;
        volume: number;
    }[]>;
    getTickerRowsForDate(ticker: string, dateStr: string, resolution: '1m' | '5m'): Promise<Record<string, unknown>[]>;
}
