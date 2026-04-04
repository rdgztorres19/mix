import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen } from '../session.utils';

export class WtPmHighBreakStrategy implements IStrategy {
  readonly name = 'WT_PM_HIGH_BREAK';

  matches(ctx: StrategyContext): boolean {
    return isTheOpen(ctx.session) &&
      ctx.pre_market_high != null &&
      ctx.price >= ctx.pre_market_high * 0.98;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const pmh = ctx.pre_market_high!;
    return { entry: pmh + 0.02, stop: pmh - 0.20, target1: pmh + 0.25, target2: pmh + 0.50 };
  }
}
