import type { IStrategy, StrategyContext, StrategyLevels } from '@small-caps/shared';
import { isTheOpen, isLateMorning } from '../session.utils';

export class WtHalfWholeDollarStrategy implements IStrategy {
  readonly name = 'WT_HALF_WHOLE_DOLLAR';

  matches(ctx: StrategyContext): boolean {
    return (isTheOpen(ctx.session) || isLateMorning(ctx.session)) &&
      ctx.halfWholeDollarDetected;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price } = ctx;
    const nearestLevel = Math.ceil(price * 2) / 2;
    return {
      entry: nearestLevel + 0.02,
      stop: nearestLevel - 0.10,
      target1: nearestLevel + 0.25,
      target2: nearestLevel + 0.50,
    };
  }
}
