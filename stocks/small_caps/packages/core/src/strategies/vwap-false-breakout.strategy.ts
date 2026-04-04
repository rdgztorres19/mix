import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isLateMorning, isMidday } from '../session.utils';

/**
 * VWAP False Breakout: stock that was strong (above VWAP) now lost VWAP = SHORT.
 * Price is below VWAP → entry at current price, stop above VWAP, targets below.
 */
export class VwapFalseBreakoutStrategy implements IStrategy {
  readonly name = 'VWAP_FALSE_BREAKOUT';

  matches(ctx: StrategyContext): boolean {
    return (isLateMorning(ctx.session) || isMidday(ctx.session)) && !ctx.aboveVwap;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, vwap, atr } = ctx;
    const v = vwap ?? price;
    return {
      entry: price,
      stop: v + atr * 0.15,
      target1: price - atr * 0.4,
      target2: price - atr * 0.8,
    };
  }
}
