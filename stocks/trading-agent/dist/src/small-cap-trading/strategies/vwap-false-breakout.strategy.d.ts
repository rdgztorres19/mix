import type { IStrategy, StrategyContext } from './strategy.interface';
import type { StrategyLevels } from '../types';
export declare class VwapFalseBreakoutStrategy implements IStrategy {
    readonly name = "VWAP_FALSE_BREAKOUT";
    matches(ctx: StrategyContext): boolean;
    getLevels(ctx: StrategyContext): StrategyLevels;
}
