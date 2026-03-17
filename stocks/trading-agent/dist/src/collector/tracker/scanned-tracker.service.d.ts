import { MysqlTrainingRepository } from '../../scanner/mysql/mysql-training.repository';
export interface ScannedSymbolData {
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
    arrived_at: Date;
    updated_at: Date;
}
export declare class ScannedTrackerService {
    private readonly mysqlRepo;
    private readonly logger;
    private trackedSymbols;
    constructor(mysqlRepo: MysqlTrainingRepository);
    onModuleInit(): Promise<void>;
    private loadTodayTrackedSymbolsFromDb;
    getTrackedSymbols(): ScannedSymbolData[];
    trackNewSymbol(symbol: string): Promise<void>;
    private fetchFloatData;
    private fetchNewsData;
    updateCalculatedMetrics(symbol: string, metrics: {
        premarket_volume: number | null;
        premarket_dollar_volume: number | null;
        volume: number | null;
        dollar_volume: number | null;
        close: number | null;
        ema9: number | null;
        gap_pct: number | null;
        passes_pre_filter: boolean;
    }): Promise<void>;
}
