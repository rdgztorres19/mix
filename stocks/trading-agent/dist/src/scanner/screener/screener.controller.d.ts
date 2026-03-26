import { ScreenerService } from './screener.service';
export declare class ScreenerController {
    private readonly screenerService;
    constructor(screenerService: ScreenerService);
    getGappers(): Promise<import("./persistence/screener.repository").ScreenerRankRow[]>;
    getGainers(): Promise<{
        session: import("./persistence/screener.repository").ScreenerRankRow[];
        intraday: import("./persistence/screener.repository").ScreenerRankRow[];
    }>;
    getGainersSession(): Promise<import("./persistence/screener.repository").ScreenerRankRow[]>;
    getCombined(): Promise<string[]>;
    getActive(): Promise<{
        rank_order: number;
        symbol: string;
        score: number;
    }[]>;
    getHighs(): Promise<{
        session: import("./persistence/screener.repository").ScreenerRankRow[];
        current: import("./persistence/screener.repository").ScreenerRankRow[];
    }>;
    getStatus(): Promise<{
        last_run_utc: string | null;
        last_session_date: string | null;
        symbols_scanned: number | null;
        note: string | null;
    }>;
    forceSync(): Promise<{
        status: string;
        symbols: number;
        ranks: boolean;
    }>;
}
