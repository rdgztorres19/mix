export type AlpacaAssetDto = {
    id: string;
    class: string;
    exchange: string;
    symbol: string;
    name: string;
    status: string;
    tradable: boolean;
    marginable: boolean;
    maintenance_margin_requirement: number | string;
    margin_requirement_long: number | string;
    margin_requirement_short: number | string;
    shortable: boolean;
    easy_to_borrow: boolean;
    fractionable: boolean;
};
export type AlpacaBar = {
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    n?: number;
    vw?: number;
};
export type SnapshotBar = {
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    n?: number;
    vw?: number;
};
export type SnapshotItem = {
    dailyBar?: SnapshotBar;
    prevDailyBar?: SnapshotBar;
    latestTrade?: {
        p: number;
        t?: string;
        s?: number;
    };
};
export type SnapshotsResponse = Record<string, SnapshotItem>;
export declare class AlpacaScreenerClient {
    private readonly logger;
    private readonly maxRetries;
    private readonly fallbackEnv;
    private loadFallbackEnv;
    private getEnvAny;
    private tradingHeaders;
    private marketDataHeaders;
    private safeReadText;
    private fetchWithRetry;
    fetchAllActiveUsEquityAssets(): Promise<AlpacaAssetDto[]>;
    fetchSnapshotsForChunk(symbols: string[]): Promise<SnapshotsResponse>;
    fetchDailyBarsForChunk(symbols: string[], startDate: string, endDate: string): Promise<Record<string, AlpacaBar[]>>;
}
