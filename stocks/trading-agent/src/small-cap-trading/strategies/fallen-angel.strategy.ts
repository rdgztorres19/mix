import type { IStrategy, StrategyContext } from './strategy.interface';
import type { StrategyLevels } from '../types';
import { isTheOpen } from '../session.utils';

/**
 * Fallen Angel — THE_OPEN only.
 * Gap-up stock that sells off from open, consolidates at support,
 * then breaks out with volume.
 */
export class FallenAngelStrategy implements IStrategy {
  readonly name = 'FALLEN_ANGEL';

  matches(ctx: StrategyContext): boolean {
    return isTheOpen(ctx.session) && ctx.fallenAngelDetected;
  }

  getLevels(ctx: StrategyContext): StrategyLevels {
    const { price, vwap, atr, pre_market_high, candles } = ctx;
    const v = vwap ?? price;

    // Stop below consolidation low (approx: recent low of last 3 candles)
    const recentLow = candles.length >= 3
      ? Math.min(...candles.slice(-3).map((c) => c.l))
      : price - atr * 0.3;

    return {
      entry: price + 0.02,
      stop: recentLow,
      target1: v,                              // VWAP as first target
      target2: pre_market_high ?? price + atr,  // PMH or ATR extension
    };
  }
}
