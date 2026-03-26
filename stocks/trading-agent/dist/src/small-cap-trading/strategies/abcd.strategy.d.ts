import type { IStrategy, StrategyContext } from './strategy.interface';
import type { StrategyLevels } from '../types';
export declare class AbcdStrategy implements IStrategy {
    readonly name = "ABCD";
    matches(ctx: StrategyContext): boolean;
    getLevels(ctx: StrategyContext): StrategyLevels;
}
