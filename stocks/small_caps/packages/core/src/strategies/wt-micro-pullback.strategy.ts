import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen, isLateMorning } from '../session.utils';

export class WtMicroPullbackStrategy implements IStrategy {
  readonly name = 'WT_MICRO_PULLBACK';

  matches(ctx: StrategyContext): boolean {
    return (isTheOpen(ctx.session) || isLateMorning(ctx.session)) &&
      ctx.microPullbackDetected && ctx.aboveEma9;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, candles } = ctx;
    const stop =
      candles.length >= 2
        ? Math.min(...candles.slice(-2).map((c) => c.l))
        : price - 0.15;
    return { entry: price + 0.02, stop, target1: price + 0.15, target2: price + 0.40 };
  }
}
