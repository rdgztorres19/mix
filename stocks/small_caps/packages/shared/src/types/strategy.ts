import type { MarketContext, PatternResult, StrategyLevels, SessionKey } from './candle';

/** Extended context with pattern detection flags for strategy matching. */
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

/** Strategy interface — each strategy implements matches + getLevels. */
export interface IStrategy {
  readonly name: string;
  matches(ctx: StrategyContext): boolean;
  getLevels(ctx: StrategyContext): StrategyLevels;
}

/** Registry entry for extensible strategy sources. */
export interface StrategyRegistration {
  strategy: IStrategy;
  source: string;
  category: 'momentum' | 'reversal' | 'breakout' | 'trend';
  sessions: SessionKey[];
}
