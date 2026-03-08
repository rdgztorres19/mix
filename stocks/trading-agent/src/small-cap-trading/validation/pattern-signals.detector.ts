import type { MarketContext, PatternResult } from '../types';
import { BullFlagDetector } from './bull-flag.detector';
import { AbcdDetector } from './abcd.detector';
import { OrbDetector } from './orb.detector';
import { VwapReversalDetector } from './vwap-reversal.detector';
import { FallenAngelDetector } from './fallen-angel.detector';
import { TechnicalSignalsDetector } from './technical-signals.detector';

export interface PatternDetectionResult {
  signals: string[];
  bullFlagDetected: boolean;
  abcdDetected: boolean;
  orbDetected: boolean;
  vwapReversalDetected: boolean;
  fallenAngelDetected: boolean;
  patterns: PatternResult[];
}

/**
 * Façade: delegates to individual pattern detectors and aggregates results.
 */
export class PatternSignalsDetector {
  private readonly bullFlag = new BullFlagDetector();
  private readonly abcd = new AbcdDetector();
  private readonly orb = new OrbDetector();
  private readonly vwapReversal = new VwapReversalDetector();
  private readonly fallenAngel = new FallenAngelDetector();
  private readonly technical = new TechnicalSignalsDetector();

  detect(ctx: MarketContext): PatternDetectionResult {
    const patterns: PatternResult[] = [];
    const signals: string[] = [];

    // Run all pattern detectors
    const bullFlagResult = this.bullFlag.detect(ctx.candles);
    const abcdResult = this.abcd.detect(ctx.candles);
    const orbResult = this.orb.detect(ctx.candles, ctx.atr);
    const vwapReversalResult = this.vwapReversal.detect(ctx.candles, ctx.vwap);
    const fallenAngelResult = this.fallenAngel.detect(ctx.candles, ctx.pre_market_high);

    if (bullFlagResult.detected) {
      patterns.push(bullFlagResult);
      signals.push(bullFlagResult.description);
    }
    if (abcdResult.detected) {
      patterns.push(abcdResult);
      signals.push(abcdResult.description);
    }
    if (orbResult.detected) {
      patterns.push(orbResult);
      signals.push(orbResult.description);
    }
    if (vwapReversalResult.detected) {
      patterns.push(vwapReversalResult);
      signals.push(vwapReversalResult.description);
    }
    if (fallenAngelResult.detected) {
      patterns.push(fallenAngelResult);
      signals.push(fallenAngelResult.description);
    }

    // Add technical context signals
    signals.push(...this.technical.detect(ctx));

    return {
      signals,
      bullFlagDetected: bullFlagResult.detected,
      abcdDetected: abcdResult.detected,
      orbDetected: orbResult.detected,
      vwapReversalDetected: vwapReversalResult.detected,
      fallenAngelDetected: fallenAngelResult.detected,
      patterns,
    };
  }
}
