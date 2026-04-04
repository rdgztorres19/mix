import type { MarketContext } from '@small-caps/shared';

export interface HardStopsResult {
  passed: boolean;
  failures: string[];
}

export class HardStopsValidator {
  validate(ctx: MarketContext): HardStopsResult {
    const failures: string[] = [];

    if (ctx.change_pct < 0.05) failures.push('Change < 5%: not enough momentum');
    if (ctx.relative_volume < 3) failures.push('Relative volume < 3x: insufficient interest');
    if (ctx.atr < 0.30) failures.push('ATR < $0.30: price range too narrow');
    if (ctx.session === 'AFTER_HOURS' || ctx.session.startsWith('AFTER_HOURS'))
      failures.push('After hours: no live trading');
    if (ctx.price < 1) failures.push('Price < $1: penny stock risk, skip');
    if (ctx.price > 50) failures.push('Price > $50: outside small cap zone');
    if (!ctx.vwap) failures.push('VWAP unavailable: cannot assess directional bias');

    return { passed: failures.length === 0, failures };
  }
}
