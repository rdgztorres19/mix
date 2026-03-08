import type { RulesResult } from './types';
import { TradingRulesEngine } from './trading-rules.engine';
import type { MarketContext, Candle } from './types';

export type { RulesResult, MarketContext, Candle, StrategyLevels, PatternResult, PatternPoint, StrategyGuidance } from './types';
export { VwapCalculator, EmaCalculator, AtrCalculator } from './indicators';

const engine = new TradingRulesEngine();

/**
 * Public API: applies trading rules to market context.
 * Keeps same signature for compatibility with agent.service and rules.tool.
 */
export function applyTradingRules(params: {
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
  last_candles_json?: string;
}): RulesResult {
  let candles: Candle[] = [];
  try {
    if (params.last_candles_json) {
      candles = JSON.parse(params.last_candles_json);
    }
  } catch {
    candles = [];
  }

  const ctx: MarketContext = {
    ticker: params.ticker,
    price: params.price,
    vwap: params.vwap,
    ema9: params.ema9,
    ema20: params.ema20,
    relative_volume: params.relative_volume,
    change_pct: params.change_pct,
    atr: params.atr,
    session: params.session,
    pre_market_high: params.pre_market_high,
    account_size: params.account_size,
    candles,
  };

  return engine.evaluate(ctx);
}
