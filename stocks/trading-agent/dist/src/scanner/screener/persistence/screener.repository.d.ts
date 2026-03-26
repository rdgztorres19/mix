export type ScreenerRankType = 'gapper' | 'gainer_intraday' | 'gainer_session' | 'high_session' | 'high_current';
export interface ScreenerAssetRow {
    symbol: string;
    asset_id: string;
    class: string;
    exchange: string;
    name: string;
    status: string;
    tradable: boolean;
    marginable: boolean;
    shortable: boolean;
    easy_to_borrow: boolean;
    fractionable: boolean;
    maintenance_margin_requirement: string | null;
    margin_requirement_long: string | null;
    margin_requirement_short: string | null;
}
export interface ScreenerRankRow {
    rank_type: ScreenerRankType;
    rank_order: number;
    symbol: string;
    metric_value: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    previous_close?: number;
    volume?: number;
}
export declare class ScreenerRepository {
    private readonly logger;
    private pool;
    private getPool;
    private dbBatchSize;
    ensureTables(): Promise<void>;
    countAssets(): Promise<number>;
    bulkInsertAssets(assets: ScreenerAssetRow[]): Promise<void>;
    getUniverseSymbols(filters: {
        onlyActive: boolean;
        onlyTradable: boolean;
        excludeOtc: boolean;
    }): Promise<string[]>;
    getPrevCloseMapForDate(asOfDate: string): Promise<Map<string, number>>;
    getPrevClose(symbol: string, asOfDate: string): Promise<number | null>;
    upsertPrevClose(symbol: string, asOfDate: string, prevClose: number, source: string): Promise<void>;
    upsertPrevClosesBatch(asOfDate: string, source: string, entries: {
        symbol: string;
        prevClose: number;
    }[]): Promise<void>;
    upsertQuoteSnapshot(symbol: string, lastPrice: number | null, dayHigh: number | null, dayLow: number | null, dayClose: number | null, volume: number | null): Promise<void>;
    upsertQuoteSnapshotsBatch(entries: {
        symbol: string;
        lastPrice: number | null;
        dayHigh: number | null;
        dayLow: number | null;
        dayClose: number | null;
        volume: number | null;
    }[]): Promise<void>;
    replaceRankRows(rankType: ScreenerRankType, rows: ScreenerRankRow[]): Promise<void>;
    getRankRows(rankType: ScreenerRankType): Promise<ScreenerRankRow[]>;
    replaceActiveSymbols(entries: {
        rank_order: number;
        symbol: string;
        score: number;
    }[]): Promise<void>;
    getActiveSymbols(): Promise<{
        symbol: string;
        score: number;
        rank_order: number;
    }[]>;
    updateRunMeta(sessionDate: string | null, symbolsScanned: number, note?: string): Promise<void>;
    getRunMeta(): Promise<{
        last_run_utc: Date | null;
        last_session_date: string | null;
        symbols_scanned: number | null;
        note: string | null;
    } | null>;
}
