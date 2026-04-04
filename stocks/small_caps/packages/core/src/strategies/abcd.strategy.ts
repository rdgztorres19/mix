import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen, isLateMorning } from '../session.utils';

export class AbcdStrategy implements IStrategy {
  readonly name = 'ABCD';

  matches(ctx: StrategyContext): boolean {
    return (isTheOpen(ctx.session) || isLateMorning(ctx.session)) &&
      ctx.abcdDetected && ctx.aboveVwap && ctx.aboveEma9;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, ema9, atr, pre_market_high } = ctx;
    const ema = ema9 ?? price;
    return {
      entry: ema,
      stop: ema - atr * 0.25,
      target1: price + atr * 0.5,
      target2: pre_market_high ?? price + atr,
    };
  }
}
