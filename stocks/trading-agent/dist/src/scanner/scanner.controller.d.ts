import { ScannerService, StockCandidate, StockSnapshot } from './scanner.service';
import { StockDataSourceFactory } from './datasource/datasource.factory';
import { MysqlTrainingRepository } from './mysql/mysql-training.repository';
import { type PatternPoint, type StrategyGuidance } from '../small-cap-trading';
export interface StockSnapshotWithStrategy extends StockSnapshot {
    strategy: {
        name: string | null;
        viable: boolean;
        entry: number | null;
        stop: number | null;
        target_1: number | null;
        target_2: number | null;
        pattern_signals: string[];
        pattern_points: PatternPoint[];
        strategy_guidance: StrategyGuidance | null;
    };
}
export interface MomoStock {
    symbol: string;
    price: number;
    change: number;
    change5m: number;
    volume: number;
    float: number | null;
    headline: string;
    headline_source: string;
    ideal: boolean;
}
import { CatalystAnalysis } from '../agent/tools/news.tool';
export declare class ScannerController {
    private readonly scannerService;
    private readonly dataSourceFactory;
    private readonly mysqlRepo;
    private readonly logger;
    constructor(scannerService: ScannerService, dataSourceFactory: StockDataSourceFactory, mysqlRepo: MysqlTrainingRepository);
    getWatchlist(): Promise<{
        generated_at: string;
        count: number;
        candidates: StockCandidate[];
    }>;
    getDates(): Promise<{
        dates: string[];
    }>;
    getSnapshot(ticker: string, cutoff?: string, date?: string): Promise<StockSnapshotWithStrategy>;
    getPattern(ticker: string, cutoff?: string, date?: string): Promise<{
        name: string | null;
        viable: boolean;
        points: PatternPoint[];
        strategy_guidance: StrategyGuidance | null;
    }>;
    getNews(ticker: string): Promise<CatalystAnalysis>;
    getTopMovers(date?: string): Promise<MomoStock[]>;
    private getMomoFromMysql;
    private getMomoFromApi;
    getMomo(interval?: string, change?: string): Promise<MomoStock[]>;
}
