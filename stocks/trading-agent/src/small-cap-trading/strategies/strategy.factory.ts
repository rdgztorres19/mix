import type { IStrategy, StrategyContext } from './strategy.interface';
import { BullFlagStrategy } from './bull-flag.strategy';
import { FallenAngelStrategy } from './fallen-angel.strategy';
import { AbcdStrategy } from './abcd.strategy';
import { OrbStrategy } from './orb.strategy';
import { VwapReversalStrategy } from './vwap-reversal.strategy';
import { VwapFalseBreakoutStrategy } from './vwap-false-breakout.strategy';
import { VwapLateMorningStrategy } from './vwap-late-morning.strategy';
import { VwapMaTrendStrategy } from './vwap-ma-trend.strategy';
import { GeneralStrategy } from './general.strategy';

/**
 * Order matters: more specific strategies first, GENERAL last.
 * BullFlag & FallenAngel are THE_OPEN-specific patterns;
 * ABCD is THE_OPEN + LATE_MORNING;
 * ORB is THE_OPEN;
 * VWAP strategies cover later sessions;
 * GENERAL is the fallback.
 */
const STRATEGIES: IStrategy[] = [
  new BullFlagStrategy(),
  new FallenAngelStrategy(),
  new AbcdStrategy(),
  new OrbStrategy(),
  new VwapReversalStrategy(),
  new VwapFalseBreakoutStrategy(),
  new VwapLateMorningStrategy(),
  new VwapMaTrendStrategy(),
  new GeneralStrategy(),
];

/**
 * Returns the first strategy that matches the context.
 * Order matters: more specific strategies first, GENERAL last.
 */
export class StrategyFactory {
  getStrategy(ctx: StrategyContext): IStrategy {
    for (const s of STRATEGIES) {
      if (s.matches(ctx)) return s;
    }
    return new GeneralStrategy();
  }
}
