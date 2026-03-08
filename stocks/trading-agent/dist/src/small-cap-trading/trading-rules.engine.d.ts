import type { MarketContext, RulesResult } from './types';
export declare class TradingRulesEngine {
    private readonly hardStops;
    private readonly patternDetector;
    private readonly strategyFactory;
    private readonly positionSizer;
    private readonly riskManager;
    private readonly guidanceGen;
    evaluate(ctx: MarketContext): RulesResult;
    private buildStrategyContext;
    private getDisplayStrategyName;
    private buildNoTradeResult;
    private buildViableResult;
}
