export interface SimConfig {
  date: string;          // YYYY-MM-DD
  startTime: string;     // HH:MM
  endTime: string;       // HH:MM
  threshold: number;     // prediction probability threshold
  targetPct: number;     // take profit %
  stopLossPct: number;   // stop loss %
  direction: 'long' | 'short';  // trade direction
}

export interface PredictPayload {
  candles: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  target_idx: number;
  candle_times_et: string[];
  candle_idx_arr: number[];
  atr: number;
  high_of_day: number;
  low_of_day: number;
  pre_market_high: number;
  change_pct_at_candle: number;
  shares_outstanding: number;
  market_cap: number;
  gap_pct: number;
  premarket_volume: number;
}

export interface PredictResult {
  tradeable: boolean;
  prob: number;
  threshold: number;
  error?: string;
  ignored?: boolean;
  ignore_reason?: string;
}

export type TpSlResult = 'win' | 'loss' | 'neutral';

export interface TradeResult {
  result: TpSlResult;
  entryPrice: number;
  exitPrice?: number;
  exitMinute?: string;
  pnlPct: number;
}

export interface Signal {
  symbol: string;
  minute: string;
  prob: number;
  trade: TradeResult;
}

export interface SymbolStats {
  signals: number;
  wins: number;
  losses: number;
  neutrals: number;
  totalPnlPct: number;
}

export interface StockProfile {
  shares_outstanding: number;
  market_cap: number;
}
