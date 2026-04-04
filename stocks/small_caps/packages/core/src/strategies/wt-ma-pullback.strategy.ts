import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen, isLateMorning } from '../session.utils';

export class WtMaPullbackStrategy implements IStrategy {
  readonly name = 'WT_MA_PULLBACK';

  matches(ctx: StrategyContext): boolean {
    return (isTheOpen(ctx.session) || isLateMorning(ctx.session)) &&
      ctx.aboveEma9 && !ctx.bullFlagDetected && !ctx.abcdDetected;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, ema9 } = ctx;
    const base = ema9 ?? price;
    return { entry: base, stop: base - 0.20, target1: price + 0.20, target2: price + 0.40 };
  }
}
