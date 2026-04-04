/**
 * Core candle and market context types.
 * Ported from trading-agent/src/small-cap-trading/types.ts
 */

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number; // timestamp ms
}

/** Normalized session names for strategy matching. */
export type SessionKey =
  | 'PRE_MARKET'
  | 'THE_OPEN'
  | 'LATE_MORNING'
  | 'MIDDAY'
  | 'THE_CLOSE'
  | 'AFTER_HOURS';

/** Input context for the trading rules engine. */
export interface MarketContext {
  ticker: string;
  price: number;
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  relative_volume: number;
  change_pct: number;
  atr: number;
  session: string;
  pre_market_high: number | null;
  account_size: number;
  candles: Candle[];
}

/** Entry, stop, targets from strategy. */
export interface StrategyLevels {
  entry: number;
  stop: number;
  target1: number;
  target2: number;
}

/** A labeled anchor point for drawing a pattern on the chart. */
export interface PatternPoint {
  label: string;
  price: number;
  time: number;
}

/** Result from an individual pattern detector. */
export interface PatternResult {
  detected: boolean;
  name: string;
  anchor_points: PatternPoint[];
  description: string;
}

/** Strategy guidance generated from knowledge chunks. */
export interface StrategyGuidance {
  what_to_watch: string;
  confirmation_signals: string[];
  invalidation: string;
  session_context: string;
  knowledge_summary: string;
}

/** Position sizing result. */
export interface PositionSizing {
  shareSize: number;
  maxRisk: number;
  perShareRisk: number;
  rrRatio: number;
}

/** Full output of the trading rules engine. */
export interface RulesResult {
  viable: boolean;
  session: string;
  identified_strategy: string | null;
  pattern_signals: string[];
  hard_stops: string[];
  entry_zone: { price: number; note: string } | null;
  stop_loss: { price: number; note: string } | null;
  target_1: { price: number; note: string } | null;
  target_2: { price: number; note: string } | null;
  share_size: number | null;
  risk_amount: number | null;
  rr_ratio: number | null;
  verdict: string;
  detected_patterns: PatternResult[];
  strategy_guidance: StrategyGuidance | null;
}
