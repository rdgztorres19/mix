import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';

export class GeneralStrategy implements IStrategy {
  readonly name = 'GENERAL';

  matches(_ctx: StrategyContext): boolean {
    return true;
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
