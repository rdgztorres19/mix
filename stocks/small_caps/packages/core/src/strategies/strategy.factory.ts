import type { IStrategy, StrategyContext } from '@small-caps/shared';
import { BullFlagStrategy } from './bull-flag.strategy';
import { FallenAngelStrategy } from './fallen-angel.strategy';
import { AbcdStrategy } from './abcd.strategy';
import { OrbStrategy } from './orb.strategy';
import { VwapReversalStrategy } from './vwap-reversal.strategy';
import { VwapFalseBreakoutStrategy } from './vwap-false-breakout.strategy';
import { VwapLateMorningStrategy } from './vwap-late-morning.strategy';
import { VwapMaTrendStrategy } from './vwap-ma-trend.strategy';
import { GeneralStrategy } from './general.strategy';

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

export class StrategyFactory {
  getStrategy(ctx: StrategyContext): IStrategy {
    for (const s of STRATEGIES) {
      if (s.matches(ctx)) return s;
    }
    return new GeneralStrategy();
  }
}
