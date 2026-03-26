import { RankingService } from './ranking/ranking.service';
export declare class ScreenerService {
    private readonly ranking;
    private readonly logger;
    constructor(ranking: RankingService);
    getTopGappers(): Promise<import("./persistence/screener.repository").ScreenerRankRow[]>;
    getTopGainers(): Promise<import("./persistence/screener.repository").ScreenerRankRow[]>;
    getGainersDetailed(): Promise<{
        session: import("./persistence/screener.repository").ScreenerRankRow[];
        intraday: import("./persistence/screener.repository").ScreenerRankRow[];
    }>;
    getTopHighs(): Promise<{
        session: import("./persistence/screener.repository").ScreenerRankRow[];
        current: import("./persistence/screener.repository").ScreenerRankRow[];
    }>;
    getActiveSymbols(): Promise<string[]>;
    getActiveDetailed(): Promise<{
        rank_order: number;
        symbol: string;
        score: number;
    }[]>;
    getStatus(): Promise<{
        last_run_utc: string | null;
        last_session_date: string | null;
        symbols_scanned: number | null;
        note: string | null;
    }>;
    getCombinedSymbols(): Promise<string[]>;
    forceSync(): Promise<{
        status: string;
        symbols: number;
        ranks: boolean;
    }>;
}
