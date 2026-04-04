import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen } from '../session.utils';

export class OrbStrategy implements IStrategy {
  readonly name = 'ORB';

  matches(ctx: StrategyContext): boolean {
    return isTheOpen(ctx.session) && ctx.orbDetected;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, vwap, atr, pre_market_high } = ctx;
    const v = vwap ?? price;
    return {
      entry: price + 0.02,
      stop: v - atr * 0.1,
      target1: pre_market_high ?? price + atr * 0.5,
      target2: price + atr,
    };
  }
}
