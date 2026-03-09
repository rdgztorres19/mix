import type { IStrategy, StrategyContext } from './strategy.interface';
import type { StrategyLevels } from '../types';
export declare class VwapReversalStrategy implements IStrategy {
    readonly name = "VWAP_REVERSAL";
    matches(ctx: StrategyContext): boolean;
    getLevels(ctx: StrategyContext): StrategyLevels;
}
