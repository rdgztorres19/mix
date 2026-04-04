import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen } from '../session.utils';

export class FallenAngelStrategy implements IStrategy {
  readonly name = 'FALLEN_ANGEL';

  matches(ctx: StrategyContext): boolean {
    return isTheOpen(ctx.session) && ctx.fallenAngelDetected;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, vwap, atr, pre_market_high, candles } = ctx;
    const v = vwap ?? price;
    const recentLow = candles.length >= 3
      ? Math.min(...candles.slice(-3).map((c) => c.l))
      : price - atr * 0.3;
    return {
      entry: price + 0.02,
      stop: recentLow,
      target1: v,
      target2: pre_market_high ?? price + atr,
    };
  }
}
