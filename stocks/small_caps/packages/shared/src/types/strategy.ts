import type { MarketContext, PatternResult, StrategyLevels, SessionKey } from './candle';

/** Extended context with pattern detection flags for strategy matching. */
export interface StrategyContext extends MarketContext {
  // Advanced Trading detectors
  bullFlagDetected: boolean;
  abcdDetected: boolean;
  orbDetected: boolean;
  vwapReversalDetected: boolean;
  fallenAngelDetected: boolean;
  // Warrior Trading detectors
  flatTopDetected: boolean;
  redToGreenDetected: boolean;
  halfWholeDollarDetected: boolean;
  microPullbackDetected: boolean;
  hodBreakDetected: boolean;
  // Computed flags
  aboveVwap: boolean;
  aboveEma9: boolean;
  aboveEma20: boolean;
  nearHod: boolean;
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
