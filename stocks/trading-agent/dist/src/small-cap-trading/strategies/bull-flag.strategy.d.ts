import type { IStrategy, StrategyContext } from './strategy.interface';
import type { StrategyLevels } from '../types';
export declare class BullFlagStrategy implements IStrategy {
    readonly name = "BULL_FLAG";
    matches(ctx: StrategyContext): boolean;
    getLevels(ctx: StrategyContext): StrategyLevels;
}
