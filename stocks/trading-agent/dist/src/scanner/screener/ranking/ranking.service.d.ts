import { AlpacaScreenerClient } from '../alpaca/alpaca-screener.client';
import { ScreenerRepository, type ScreenerRankRow } from '../persistence/screener.repository';
import { AssetsService } from '../assets/assets.service';
import { ActiveSymbolsService } from '../active/active-symbols.service';
export declare class RankingService {
    private readonly alpaca;
    private readonly assets;
    private readonly repo;
    private readonly activeSymbols;
    private readonly logger;
    private prevCloseCacheSessionDate;
    private prevCloseCache;
    private prevCloseCachePromise;
    private fullSyncInFlight;
    constructor(alpaca: AlpacaScreenerClient, assets: AssetsService, repo: ScreenerRepository, activeSymbols: ActiveSymbolsService);
    private chunkSize;
    private concurrency;
    private topN;
    private volumenRequired;
    getTopGappers(): Promise<ScreenerRankRow[]>;
    getTopGainersSession(): Promise<ScreenerRankRow[]>;
    getTopGainersIntraday(): Promise<ScreenerRankRow[]>;
    getTopGainers(): Promise<ScreenerRankRow[]>;
    getTopHighs(): Promise<{
        session: ScreenerRankRow[];
        current: ScreenerRankRow[];
    }>;
    getCombinedSymbols(): Promise<string[]>;
    getActiveRows(): Promise<{
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
    syncAllRankings(): Promise<{
        status: string;
        symbols: number;
        ranks: boolean;
    }>;
    refreshQuoteCacheOnly(): Promise<{
        status: string;
        symbols: number;
    }>;
    private mergeSnapshots;
    private ensurePrevCloseCache;
    private persistQuotesBatch;
    private runPipeline;
}
