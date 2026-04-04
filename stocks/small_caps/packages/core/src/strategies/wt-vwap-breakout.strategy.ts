import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen, isLateMorning, isMidday } from '../session.utils';

export class WtVwapBreakoutStrategy implements IStrategy {
  readonly name = 'WT_VWAP_BREAKOUT';

  matches(ctx: StrategyContext): boolean {
    return (isTheOpen(ctx.session) || isLateMorning(ctx.session) || isMidday(ctx.session)) &&
      ctx.aboveVwap && ctx.vwap != null &&
      ctx.price > ctx.vwap && ctx.price < ctx.vwap * 1.01;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, atr, vwap, pre_market_high } = ctx;
    const v = vwap!;
    return {
      entry: v + 0.02,
      stop: v - 0.10,
      target1: price + atr * 0.5,
      target2: pre_market_high ?? price + atr,
    };
  }
}
