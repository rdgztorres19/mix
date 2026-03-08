import type { IStrategy, StrategyContext } from './strategy.interface';
import type { StrategyLevels } from '../types';

/**
 * Fallback strategy when no specific pattern matches.
 */
export class GeneralStrategy implements IStrategy {
  readonly name = 'GENERAL';

  matches(_ctx: StrategyContext): boolean {
    return true; // Always matches as fallback
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, atr } = ctx;
    return {
      entry: price,
      stop: price - atr * 0.3,
      target1: price + atr * 0.5,
      target2: price + atr,
    };
  }
}
