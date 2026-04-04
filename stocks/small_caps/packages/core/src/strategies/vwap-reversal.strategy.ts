import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen, isLateMorning } from '../session.utils';

export class VwapReversalStrategy implements IStrategy {
  readonly name = 'VWAP_REVERSAL';

  matches(ctx: StrategyContext): boolean {
    return (isTheOpen(ctx.session) || isLateMorning(ctx.session)) &&
      !ctx.aboveVwap && ctx.vwapReversalDetected;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, vwap, ema9, atr } = ctx;
    const v = vwap ?? price;
    return {
      entry: v - atr * 0.1,
      stop: price - atr * 0.3,
      target1: v + atr * 0.3,
      target2: (ema9 ?? price) + atr * 0.6,
    };
  }
}
