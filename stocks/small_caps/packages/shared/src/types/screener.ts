/** Screener rank types matching the 5 ranking functions. */
export type ScreenerRankType =
  | 'gapper'
  | 'gainer_session'
  | 'gainer_intraday'
  | 'high_session'
  | 'high_current';

/** A single row in a screener ranking. */
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

/** Combined screener result for a date. */
export interface ScreenerResult {
  date: string;
  symbols: ScreenerSymbol[];
}

export interface ScreenerSymbol {
  symbol: string;
  rank: number;
  gapPct: number;
  changePct: number;
  volume: number;
  rankTypes: ScreenerRankType[];
  previousClose: number;
  open: number;
  close: number;
  high: number;
  low: number;
}
