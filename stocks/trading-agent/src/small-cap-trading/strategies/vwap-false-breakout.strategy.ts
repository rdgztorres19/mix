import type { IStrategy, StrategyContext } from './strategy.interface';
import type { StrategyLevels } from '../types';
import { isLateMorning, isMidday } from '../session.utils';

export class VwapFalseBreakoutStrategy implements IStrategy {
  readonly name = 'VWAP_FALSE_BREAKOUT';

  matches(ctx: StrategyContext): boolean {
    return (isLateMorning(ctx.session) || isMidday(ctx.session)) && !ctx.aboveVwap;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, vwap, atr } = ctx;
    return {
      entry: vwap ? vwap + 0.02 : price,
      stop: vwap ? vwap - atr * 0.15 : price - atr * 0.2,
      target1: price + atr * 0.4,
      target2: price + atr * 0.8,
    };
  }
}
