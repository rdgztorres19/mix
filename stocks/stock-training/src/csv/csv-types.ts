/**
 * CSV row interface and column constants.
 * Single responsibility: type definitions for training CSV output.
 */

export interface CsvRow {
  symbol: string;
  date: string;
  candle_time_et: string;
  candle_idx: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  atr: number;
  vwap: number | null;
  high_of_day: number;
  low_of_day: number;
  change_pct_at_candle: number;
  ema9: number | null;
  ema20: number | null;
  pre_market_high: number | null;
  session: string;
  // New features
  shares_outstanding: number | null;
  market_cap: number | null;
  gap_pct: number | null;
  premarket_volume: number | null;
  momentum_acumulado: number | null;
  change_1m: number | null;
  change_5m: number | null;
  change_10m: number | null;
  minutes_since_hod: number | null;
  // Add-features momentum intradía (~30)
  volume_rel?: number;
  dist_vwap_pct?: number;
  atr_rel?: number;
  minute_of_day?: number;
  rsi?: number;
  volatility_15m?: number;
  mom_5?: number;
  mom_10?: number;
  return_lag_1?: number;
  return_lag_2?: number;
  return_lag_3?: number;
  dist_hod_pct?: number;
  dist_lod_pct?: number;
  dist_pm_high?: number;
  break_hod?: number;
  break_pm_high?: number;
  range_expansion?: number;
  float_rotation?: number;
  dollar_volume?: number;
  relative_dollar_volume?: number;
  volume_spike?: number;
  vwap_cross_up?: number;
  dist_ema9?: number;
  dist_ema20?: number;
  momentum_acceleration?: number;
  is_open?: number;
  is_midday?: number;
  is_power_hour?: number;
  dist_gap?: number;
  relative_range?: number;
  // Labels
  future_return_5m: number | null;
  /** Multiclass: -1 (bearish), 0 (neutral), 1 (bullish) */
  target: -1 | 0 | 1 | null;
  target_break_hod_5m: number | null;
  max_future_return_10m: number | null;
}

export const CSV_COLUMNS = [
  'symbol', 'date', 'candle_time_et', 'candle_idx', 'open', 'high', 'low', 'close', 'volume',
  'atr', 'vwap', 'high_of_day', 'low_of_day', 'change_pct_at_candle', 'ema9', 'ema20',
  'pre_market_high', 'session',
  'shares_outstanding', 'market_cap', 'gap_pct', 'premarket_volume',
  'momentum_acumulado', 'change_1m', 'change_5m', 'change_10m', 'minutes_since_hod',
  'volume_rel', 'dist_vwap_pct', 'atr_rel', 'minute_of_day', 'rsi', 'volatility_15m',
  'mom_5', 'mom_10', 'return_lag_1', 'return_lag_2', 'return_lag_3',
  'dist_hod_pct', 'dist_lod_pct', 'dist_pm_high', 'break_hod', 'break_pm_high',
  'range_expansion', 'float_rotation', 'dollar_volume', 'relative_dollar_volume',
  'volume_spike', 'vwap_cross_up', 'dist_ema9', 'dist_ema20', 'momentum_acceleration',
  'is_open', 'is_midday', 'is_power_hour', 'dist_gap', 'relative_range',
  'future_return_5m', 'target', 'target_break_hod_5m', 'max_future_return_10m',
] as const;
