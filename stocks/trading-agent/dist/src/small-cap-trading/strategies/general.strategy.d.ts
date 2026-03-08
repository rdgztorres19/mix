import type { IStrategy, StrategyContext } from './strategy.interface';
import type { StrategyLevels } from '../types';
export declare class GeneralStrategy implements IStrategy {
    readonly name = "GENERAL";
    matches(_ctx: StrategyContext): boolean;
    getLevels(ctx: StrategyContext): StrategyLevels;
}
