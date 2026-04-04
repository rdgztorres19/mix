import type { Candle, RulesResult, StrategyGuidance, StrategyLevels } from './candle';

/** Detected candlestick pattern at a specific candle. */
export interface CandlestickPattern {
  name: string;
  candleIdx: number;
  significance: 'bullish' | 'bearish' | 'neutral';
  description: string;
}

/** Support/resistance level. */
export interface SRLevel {
  label: string;
  price: number;
  type: 'support' | 'resistance' | 'dynamic';
}

/** Active strategy signal at a given candle step. */
export interface ActiveStrategy {
  name: string;
  source: string;
  guidance: StrategyGuidance;
  levels: StrategyLevels;
  category: 'momentum' | 'reversal' | 'breakout' | 'trend';
}

/** Indicator values at a given candle. */
export interface IndicatorValues {
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  sma50: number | null;
  sma200: number | null;
  atr: number;
  rsi: number | null;
}

/** Full simulation state at a given candle index. */
export interface SimulationState {
  symbol: string;
  date: string;
  candleIdx: number;
  maxIdx: number;
  candles: Candle[];
  indicators: IndicatorValues[];
  activeStrategies: ActiveStrategy[];
  candlestickPatterns: CandlestickPattern[];
  supportResistanceLevels: SRLevel[];
  rulesResult: RulesResult;
}
