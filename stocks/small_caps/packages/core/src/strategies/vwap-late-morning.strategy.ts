import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isLateMorning } from '../session.utils';

export class VwapLateMorningStrategy implements IStrategy {
  readonly name = 'VWAP_LATE_MORNING';

  matches(ctx: StrategyContext): boolean {
    return isLateMorning(ctx.session) && ctx.aboveVwap;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, vwap, atr, ema9 } = ctx;
    const v = vwap ?? price;
    const ema = ema9 ?? price;
    return {
      entry: price,
      stop: Math.min(v - atr * 0.15, ema - atr * 0.2),
      target1: price + atr * 0.5,
      target2: price + atr,
    };
  }
}
