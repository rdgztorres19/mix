export interface CollectorCandle {
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
    t: number;
}
export interface SymbolMetadata {
    priorClose: number;
    preMarketHigh: number;
    sharesOutstanding: number;
    marketCap: number;
    gapPct: number;
    premarketVolume: number;
}
export interface CandleRow {
    symbol: string;
    date: string;
    candle_idx: number;
    candle_time_et: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    atr: number;
    vwap: number;
    ema9: number;
    ema20: number;
    high_of_day: number;
    low_of_day: number;
    change_pct_at_candle: number;
    pre_market_high: number;
    session: string;
    shares_outstanding: number;
    market_cap: number;
    gap_pct: number;
    premarket_volume: number;
    change_1m: number;
    change_5m: number;
    change_10m: number;
    minutes_since_hod: number;
}
export declare function timestampToET(ms: number): {
    date: string;
    time: string;
    minuteOfDay: number;
};
export declare function computeCandleRow(symbol: string, history: CollectorCandle[], metadata: SymbolMetadata): CandleRow;
