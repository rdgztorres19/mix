export interface StockCandidate {
    ticker: string;
    price: number;
    change_pct: number;
    relative_volume: number;
    volume: number;
    avg_volume: number;
    float: number | null;
    market_cap: number | null;
    atr: number;
    pre_market_high: number | null;
    vwap: number | null;
    priority_score: number;
    reason: string;
}
export interface VwapPoint {
    t: number;
    value: number;
}
export interface StockSnapshot {
    ticker: string;
    price: number;
    vwap: number | null;
    vwap_line: VwapPoint[];
    ema9: number | null;
    ema20: number | null;
    volume: number;
    avg_volume: number;
    relative_volume: number;
    change_pct: number;
    pre_market_high: number | null;
    candles_1min: Candle[];
    candles_5min: Candle[];
    atr: number;
    high_of_day: number;
    low_of_day: number;
}
export interface Candle {
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    t: number;
}
export declare class ScannerService {
    private readonly logger;
    private readonly momoBase;
    private readonly FILTERS;
    private readonly PRE_MARKET_HOUR_ET;
    private readonly TRADING_DAYS_HISTORY;
    private readonly ATR_PERIOD;
    private readonly TOOL_CANDLES_SHOWN;
    constructor();
    getStockSnapshot(ticker: string, cutoffMs?: number, timeframe?: '1m' | '5m'): Promise<StockSnapshot>;
    getStockSnapshotFromMomo(ticker: string, cutoffMs?: number, timeframe?: '1m' | '5m'): Promise<StockSnapshot>;
    runScanner(tickers?: string[]): Promise<StockCandidate[]>;
    private evaluateSnapshot;
    private getDefaultWatchlist;
    private getTodayMarketOpenMs;
    private getHistoryStartMs;
    private estimateAvgDailyVolume;
    private aggregate1mTo5m;
    private getMockSnapshot;
}
