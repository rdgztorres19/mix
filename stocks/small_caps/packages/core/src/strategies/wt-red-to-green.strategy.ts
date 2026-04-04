import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen } from '../session.utils';

export class WtRedToGreenStrategy implements IStrategy {
  readonly name = 'WT_RED_TO_GREEN';

  matches(ctx: StrategyContext): boolean {
    return isTheOpen(ctx.session) && ctx.redToGreenDetected;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price } = ctx;
    return { entry: price + 0.02, stop: price - 0.20, target1: price + 0.20, target2: price + 0.40 };
  }
}
