/** Metadata for a symbol required for indicator computation. */
export interface SymbolMetadata {
  priorClose: number;
  preMarketHigh: number;
  sharesOutstanding: number | null;
  marketCap: number | null;
  gapPct: number;
  premarketVolume: number;
}

/** Full candle row with computed indicators (maps to candle_1m table). */
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
  timestamp_ms: number;
}
