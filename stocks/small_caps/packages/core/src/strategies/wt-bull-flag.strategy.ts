import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen, isLateMorning } from '../session.utils';

export class WtBullFlagStrategy implements IStrategy {
  readonly name = 'WT_BULL_FLAG';

  matches(ctx: StrategyContext): boolean {
    return (isTheOpen(ctx.session) || isLateMorning(ctx.session)) &&
      ctx.bullFlagDetected && ctx.aboveEma9 &&
      ctx.price >= 2 && ctx.price <= 20;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, candles } = ctx;
    const stop =
      candles.length >= 2
        ? Math.min(...candles.slice(-2).map((c) => c.l))
        : price - 0.20;
    return { entry: price + 0.02, stop, target1: price + 0.20, target2: price + 0.40 };
  }
}
