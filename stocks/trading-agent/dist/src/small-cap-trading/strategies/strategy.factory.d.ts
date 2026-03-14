import type { IStrategy, StrategyContext } from './strategy.interface';
export declare class StrategyFactory {
    getStrategy(ctx: StrategyContext): IStrategy;
}
