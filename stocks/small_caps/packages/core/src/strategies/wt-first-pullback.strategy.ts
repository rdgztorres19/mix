import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen } from '../session.utils';

export class WtFirstPullbackStrategy implements IStrategy {
  readonly name = 'WT_FIRST_PULLBACK';

  matches(ctx: StrategyContext): boolean {
    return isTheOpen(ctx.session) &&
      (ctx.bullFlagDetected || ctx.flatTopDetected) && ctx.aboveVwap;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, candles } = ctx;
    const stop =
      candles.length >= 5
        ? Math.min(...candles.slice(-5).map((c) => c.l))
        : price - 0.20;
    return { entry: price + 0.02, stop, target1: price + 0.20, target2: price + 0.40 };
  }
}
