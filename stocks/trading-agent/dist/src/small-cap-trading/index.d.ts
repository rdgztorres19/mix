import type { RulesResult } from './types';
export type { RulesResult, MarketContext, Candle, StrategyLevels, PatternResult, PatternPoint, StrategyGuidance } from './types';
export { VwapCalculator, EmaCalculator, AtrCalculator } from './indicators';
export declare function applyTradingRules(params: {
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
}): RulesResult;
