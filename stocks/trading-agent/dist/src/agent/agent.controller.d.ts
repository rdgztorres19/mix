import { AgentService, AnalyzeResponse } from './agent.service';
import { AnalysisLogService } from '../analysis-log/analysis-log.service';
import { NewsCacheService } from '../cache/news-cache.service';
declare class AnalyzeDto {
    ticker: string;
    account_size?: number;
    timeframe?: '1m' | '5m';
    cutoff_ms?: number;
    fast?: boolean;
}
export declare class AgentController {
    private readonly agentService;
    private readonly analysisLog;
    private readonly newsCache;
    private readonly logger;
    constructor(agentService: AgentService, analysisLog: AnalysisLogService, newsCache: NewsCacheService);
    analyze(body: AnalyzeDto): Promise<AnalyzeResponse>;
    getLogs(limit?: string, ticker?: string): Promise<import("../analysis-log/analysis-log.service").AnalysisLogEntry[]>;
    getLogById(id: string): Promise<import("../analysis-log/analysis-log.service").AnalysisLogEntry>;
    getCacheStatus(ticker: string): Promise<{
        ticker: string;
        cached: boolean;
        ttl_remaining_sec: number;
        age_sec?: undefined;
        catalyst?: undefined;
    } | {
        ticker: string;
        cached: boolean;
        ttl_remaining_sec: number;
        age_sec: number;
        catalyst: import("../cache/news-cache.service").CachedCatalyst;
    }>;
    invalidateCache(ticker: string): Promise<{
        ticker: string;
        invalidated: boolean;
    }>;
}
export {};
