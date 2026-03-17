import type { TrainingCandle } from './types';
export interface TrainingRowOutput {
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
    gap_pct: number | null;
    premarket_volume: number;
    momentum_acumulado: number | null;
    change_1m: number | null;
    change_5m: number | null;
    change_10m: number | null;
    minutes_since_hod: number | null;
    future_return_5m: number | null;
    target: number | null;
    target_break_hod_5m: number | null;
    max_future_return_10m: number | null;
}
export interface BuildTrainingRowInput {
    symbol: string;
    date: string;
    candles: TrainingCandle[];
    idx: number;
    priorClose: number;
    openDay: number;
    openFirst: number;
    premarketVolume: number;
    preMarketHigh: number | null;
    sharesOutstanding?: number | null;
    marketCap?: number | null;
}
export declare function buildTrainingRow(input: BuildTrainingRowInput): TrainingRowOutput;
