import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen, isLateMorning } from '../session.utils';

export class WtHodBreakStrategy implements IStrategy {
  readonly name = 'WT_HOD_BREAK';

  matches(ctx: StrategyContext): boolean {
    return (isTheOpen(ctx.session) || isLateMorning(ctx.session)) &&
      ctx.hodBreakDetected;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price } = ctx;
    return { entry: price + 0.02, stop: price - 0.20, target1: price + 0.25, target2: price + 0.50 };
  }
}
