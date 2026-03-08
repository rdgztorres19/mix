/**
 * Shared types for small-cap trading engine.
 * Single source of truth for Candle, MarketContext, StrategyLevels, RulesResult.
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
  session: string; // raw from getSession, e.g. "THE_OPEN (9:30-10:30am)"
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
  label: string;   // e.g. "A", "B", "C", "D", "PoleStart", "FlagLow", "ORB_High"
  price: number;
  time: number;    // timestamp ms
}

/** Result from an individual pattern detector. */
export interface PatternResult {
  detected: boolean;
  name: string;              // e.g. "BULL_FLAG", "ABCD", "ORB"
  anchor_points: PatternPoint[];
  description: string;       // human-readable one-liner
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

/** Full output of the trading rules engine. Matches RulesResult from rules.tool. */
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
  /** Anchor points for pattern visualization on chart. */
  detected_patterns: PatternResult[];
  /** Guidance text from knowledge chunks for the identified strategy. */
  strategy_guidance: StrategyGuidance | null;
}
