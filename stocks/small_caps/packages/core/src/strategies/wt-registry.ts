/**
 * Registers all Warrior Trading strategies into the registry.
 * Call this after createDefaultRegistry() to add WT strategies.
 */
import type { StrategyRegistry } from './strategy.registry';
import { WtBullFlagStrategy } from './wt-bull-flag.strategy';
import { WtFlatTopStrategy } from './wt-flat-top.strategy';
import { WtAbcdStrategy } from './wt-abcd.strategy';
import { WtFirstPullbackStrategy } from './wt-first-pullback.strategy';
import { WtMaPullbackStrategy } from './wt-ma-pullback.strategy';
import { WtPmHighBreakStrategy } from './wt-pm-high-break.strategy';
import { WtHalfWholeDollarStrategy } from './wt-half-whole-dollar.strategy';
import { WtRedToGreenStrategy } from './wt-red-to-green.strategy';
import { WtMicroPullbackStrategy } from './wt-micro-pullback.strategy';
import { WtVwapBreakoutStrategy } from './wt-vwap-breakout.strategy';
import { WtHodBreakStrategy } from './wt-hod-break.strategy';

export function registerWarriorTradingStrategies(registry: StrategyRegistry): void {
  const source = 'Warrior Trading';

  registry.register({ strategy: new WtFirstPullbackStrategy(), source, category: 'momentum', sessions: ['THE_OPEN'] });
  registry.register({ strategy: new WtBullFlagStrategy(), source, category: 'breakout', sessions: ['THE_OPEN', 'LATE_MORNING'] });
  registry.register({ strategy: new WtFlatTopStrategy(), source, category: 'breakout', sessions: ['THE_OPEN', 'LATE_MORNING'] });
  registry.register({ strategy: new WtAbcdStrategy(), source, category: 'momentum', sessions: ['THE_OPEN', 'LATE_MORNING'] });
  registry.register({ strategy: new WtPmHighBreakStrategy(), source, category: 'breakout', sessions: ['THE_OPEN'] });
  registry.register({ strategy: new WtRedToGreenStrategy(), source, category: 'reversal', sessions: ['THE_OPEN'] });
  registry.register({ strategy: new WtHodBreakStrategy(), source, category: 'breakout', sessions: ['THE_OPEN', 'LATE_MORNING'] });
  registry.register({ strategy: new WtMicroPullbackStrategy(), source, category: 'momentum', sessions: ['THE_OPEN', 'LATE_MORNING'] });
  registry.register({ strategy: new WtHalfWholeDollarStrategy(), source, category: 'breakout', sessions: ['THE_OPEN', 'LATE_MORNING'] });
  registry.register({ strategy: new WtVwapBreakoutStrategy(), source, category: 'breakout', sessions: ['THE_OPEN', 'LATE_MORNING', 'MIDDAY'] });
  registry.register({ strategy: new WtMaPullbackStrategy(), source, category: 'trend', sessions: ['THE_OPEN', 'LATE_MORNING'] });
}
