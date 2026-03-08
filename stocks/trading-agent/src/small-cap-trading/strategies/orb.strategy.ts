import type { IStrategy, StrategyContext } from './strategy.interface';
import type { StrategyLevels } from '../types';
import { isTheOpen } from '../session.utils';

/**
 * Opening Range Breakout — THE_OPEN only.
 * Requires ORB range detected and price broken above/below range.
 */
export class OrbStrategy implements IStrategy {
  readonly name = 'ORB';

  matches(ctx: StrategyContext): boolean {
    return isTheOpen(ctx.session) && ctx.orbDetected;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, vwap, atr, pre_market_high } = ctx;
    const v = vwap ?? price;

    // ORB: entry at breakout, stop below VWAP (for longs)
    return {
      entry: price + 0.02,
      stop: v - atr * 0.1,
      target1: pre_market_high ?? price + atr * 0.5,
      target2: price + atr,
    };
  }
}
