export declare class MysqlTrainingRepository {
    private readonly logger;
    private pool;
    private getPool;
    getSymbolsForDate(dateStr: string): Promise<string[]>;
    getAvailableDates(): Promise<string[]>;
    getTickerRows(ticker: string, resolution: '1m' | '5m'): Promise<Record<string, unknown>[]>;
    getTopMovers(dateStr: string): Promise<{
        symbol: string;
        change_pct: number;
        close: number;
        volume: number;
    }[]>;
    getTickerRowsForDate(ticker: string, dateStr: string, resolution: '1m' | '5m'): Promise<Record<string, unknown>[]>;
    ensureCollectorTable(): Promise<void>;
    ensureTrackerTable(): Promise<void>;
    upsertScannedSymbol(data: {
        symbol: string;
        passes_pre_filter: boolean;
        float_shares: number | null;
        outstanding_shares: number | null;
        free_float: number | null;
        catalyst_strength: string | null;
        catalyst_type: string | null;
        premarket_volume: number | null;
        premarket_dollar_volume: number | null;
        volume: number | null;
        dollar_volume: number | null;
        close: number | null;
        ema9: number | null;
        gap_pct: number | null;
    }): Promise<void>;
    getScannedSymbolsForToday(): Promise<Record<string, unknown>[]>;
    passesPrefilterForToday(symbol: string): Promise<boolean>;
    saveActiveSymbol(symbol: string, source: string): Promise<void>;
    getActiveSymbols(): Promise<{
        symbol: string;
        source: string;
        added_at: string;
    }[]>;
    deactivateAllSymbols(): Promise<void>;
    getLastCandleForSymbol(symbol: string, dateStr: string): Promise<{
        candle_idx: number;
        candle_time_et: string;
    } | null>;
    getRecentCandles(symbol: string, dateStr: string, limit?: number): Promise<Record<string, unknown>[]>;
    upsertCandle(row: Record<string, unknown>): Promise<void>;
    bulkUpsertCandles(rows: Record<string, unknown>[]): Promise<void>;
    deleteCandlesForDate(dateStr: string): Promise<number>;
    deleteCandlesForSymbolDate(symbol: string, date: string): Promise<number>;
}
