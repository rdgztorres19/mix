import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen, isLateMorning } from '../session.utils';

export class BullFlagStrategy implements IStrategy {
  readonly name = 'BULL_FLAG';

  matches(ctx: StrategyContext): boolean {
    return (isTheOpen(ctx.session) || isLateMorning(ctx.session)) && ctx.bullFlagDetected && ctx.aboveVwap;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, atr, pre_market_high, candles } = ctx;
    const stop =
      candles.length >= 2
        ? Math.min(...candles.slice(-2).map((c) => c.l))
        : price - atr * 0.3;
    const t1 = pre_market_high ?? price + atr * 0.5;
    const t2 = price + atr;
    return { entry: price + 0.02, stop, target1: t1, target2: t2 };
  }
}
