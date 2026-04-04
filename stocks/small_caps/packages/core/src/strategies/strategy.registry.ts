import type { IStrategy, StrategyContext, StrategyRegistration } from '@small-caps/shared';
import { BullFlagStrategy } from './bull-flag.strategy';
import { FallenAngelStrategy } from './fallen-angel.strategy';
import { AbcdStrategy } from './abcd.strategy';
import { OrbStrategy } from './orb.strategy';
import { VwapReversalStrategy } from './vwap-reversal.strategy';
import { VwapFalseBreakoutStrategy } from './vwap-false-breakout.strategy';
import { VwapLateMorningStrategy } from './vwap-late-morning.strategy';
import { VwapMaTrendStrategy } from './vwap-ma-trend.strategy';

/**
 * Extensible strategy registry — supports multiple sources.
 * All current strategies registered under "Advanced Trading".
 * New sources register via `register()`.
 */
export class StrategyRegistry {
  private registrations: StrategyRegistration[] = [];

  register(reg: StrategyRegistration): void {
    this.registrations.push(reg);
  }

  getAll(): StrategyRegistration[] {
    return [...this.registrations];
  }

  getBySource(source: string): StrategyRegistration[] {
    return this.registrations.filter((r) => r.source === source);
  }

  /** Returns the first matching strategy registration. */
  evaluate(ctx: StrategyContext): StrategyRegistration | null {
    return this.registrations.find((r) => r.strategy.matches(ctx)) ?? null;
  }

  /** Returns ALL matching strategy registrations. */
  evaluateAll(ctx: StrategyContext): StrategyRegistration[] {
    return this.registrations.filter((r) => r.strategy.matches(ctx));
  }
}

/** Create a registry pre-loaded with "Advanced Trading" strategies. */
export function createDefaultRegistry(): StrategyRegistry {
  const registry = new StrategyRegistry();
  const source = 'Advanced Trading';

  registry.register({ strategy: new BullFlagStrategy(), source, category: 'momentum', sessions: ['THE_OPEN', 'LATE_MORNING'] });
  registry.register({ strategy: new FallenAngelStrategy(), source, category: 'reversal', sessions: ['THE_OPEN'] });
  registry.register({ strategy: new AbcdStrategy(), source, category: 'momentum', sessions: ['THE_OPEN', 'LATE_MORNING'] });
  registry.register({ strategy: new OrbStrategy(), source, category: 'breakout', sessions: ['THE_OPEN'] });
  registry.register({ strategy: new VwapReversalStrategy(), source, category: 'reversal', sessions: ['THE_OPEN', 'LATE_MORNING'] });
  registry.register({ strategy: new VwapFalseBreakoutStrategy(), source, category: 'reversal', sessions: ['LATE_MORNING', 'MIDDAY'] });
  registry.register({ strategy: new VwapLateMorningStrategy(), source, category: 'trend', sessions: ['LATE_MORNING'] });
  registry.register({ strategy: new VwapMaTrendStrategy(), source, category: 'trend', sessions: ['MIDDAY', 'THE_CLOSE'] });

  // Register Warrior Trading strategies
  registerWarriorTradingStrategies(registry);

  return registry;
}

// Lazy import to avoid circular deps
import { registerWarriorTradingStrategies } from './wt-registry';
