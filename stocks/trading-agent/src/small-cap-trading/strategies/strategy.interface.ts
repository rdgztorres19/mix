import type { MarketContext, StrategyLevels, PatternResult } from '../types';

/**
 * Enriched context: MarketContext + pattern detection results for strategy matching.
 */
export interface StrategyContext extends MarketContext {
  bullFlagDetected: boolean;
  abcdDetected: boolean;
  orbDetected: boolean;
  vwapReversalDetected: boolean;
  fallenAngelDetected: boolean;
  aboveVwap: boolean;
  aboveEma9: boolean;
  aboveEma20: boolean;
  detectedPatterns: PatternResult[];
}

export interface IStrategy {
  readonly name: string;
  matches(ctx: StrategyContext): boolean;
  getLevels(ctx: StrategyContext): StrategyLevels;
}
