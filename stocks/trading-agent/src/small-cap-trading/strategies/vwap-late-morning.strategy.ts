import type { IStrategy, StrategyContext } from './strategy.interface';
import type { StrategyLevels } from '../types';
import { isLateMorning } from '../session.utils';

/**
 * LATE_MORNING + above VWAP — continuation play; no specific pattern in THE_OPEN.
 */
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
