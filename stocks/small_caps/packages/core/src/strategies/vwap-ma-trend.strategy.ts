import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isMidday, isTheClose } from '../session.utils';

export class VwapMaTrendStrategy implements IStrategy {
  readonly name = 'VWAP_MA_TREND';

  matches(ctx: StrategyContext): boolean {
    return (isMidday(ctx.session) || isTheClose(ctx.session)) &&
      ctx.aboveVwap && ctx.aboveEma20;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, ema20, atr } = ctx;
    const ema = ema20 ?? price;
    return {
      entry: ema,
      stop: ema - atr * 0.2,
      target1: price + atr * 0.4,
      target2: price + atr * 0.8,
    };
  }
}
