/**
 * Shared types for stock-training pipeline.
 */

export interface TopGainerEntry {
  symbol: string;
  Date: string; // YYYY-MM-DD
  percent_gain: number;
  Volume: number;
  High: number;
}

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number; // timestamp ms
}

export type SessionKey =
  | 'PRE_MARKET'
  | 'THE_OPEN'
  | 'LATE_MORNING'
  | 'MIDDAY'
  | 'THE_CLOSE'
  | 'AFTER_HOURS';

/** Catalyst types aligned with trading-agent news.tool */
export type CatalystType =
  | 'BUYOUT_ACQUISITION'
  | 'SPLIT'
  | 'FDA_APPROVAL'
  | 'EARNINGS_BEAT'
  | 'CONTRACT_AWARD'
  | 'PARTNERSHIP'
  | 'DILUTIVE_OFFERING'
  | 'SHORT_SQUEEZE'
  | 'UPLISTING'
  | 'PRODUCT_LAUNCH'
  | 'OTHER'
  | 'NONE';

export interface NewsItem {
  title: string;
  publisher: string;
  published_at: string;
  url: string;
  age_minutes: number;
}

export interface TrainingRow {
  symbol: string;
  date: string;
  candle_time_et: string; // HH:MM ET
  candle_timestamp_ms: number;
  price: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  atr: number;
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  high_of_day: number;
  low_of_day: number;
  change_today_pct: number;
  pre_market_high: number | null;
  session: SessionKey;
  had_news: boolean;
  catalyst_type: CatalystType;
  catalyst_strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  percent_gain_final: number; // from top_gainers
}
