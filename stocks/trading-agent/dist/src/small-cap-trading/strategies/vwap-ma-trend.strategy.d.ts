import type { IStrategy, StrategyContext } from './strategy.interface';
import type { StrategyLevels } from '../types';
export declare class VwapMaTrendStrategy implements IStrategy {
    readonly name = "VWAP_MA_TREND";
    matches(ctx: StrategyContext): boolean;
    getLevels(ctx: StrategyContext): StrategyLevels;
}
