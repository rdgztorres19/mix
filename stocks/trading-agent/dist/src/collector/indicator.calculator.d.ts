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
    sharesOutstanding: number | null;
    marketCap: number | null;
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
    shares_outstanding: number | null;
    market_cap: number | null;
    gap_pct: number;
    premarket_volume: number;
    change_1m: number;
    change_5m: number;
    change_10m: number;
    minutes_since_hod: number;
    momentum_acumulado: number | null;
    future_return_5m?: number | null;
    target?: number | null;
    target_break_hod_5m?: number | null;
    max_future_return_10m?: number | null;
    original_timestamp_ms?: number;
}
export declare function timestampToET(ms: number): {
    date: string;
    time: string;
    minuteOfDay: number;
};
export declare function computeCandleRow(symbol: string, history: CollectorCandle[], metadata: SymbolMetadata): CandleRow;
