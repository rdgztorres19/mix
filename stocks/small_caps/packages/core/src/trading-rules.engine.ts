import type { MarketContext, PatternResult, RulesResult, StrategyGuidance, StrategyLevels, StrategyContext } from '@small-caps/shared';
import { HardStopsValidator } from './validation/hard-stops.validator';
import { PatternSignalsDetector, type PatternDetectionResult } from './detectors/pattern-signals.detector';
import { StrategyFactory } from './strategies/strategy.factory';
import { PositionSizer } from './position-sizing/position-sizer';
import { RiskManager } from './risk-management/risk-manager';
import { StrategyGuidanceGenerator } from './strategy-guidance.generator';

/**
 * Orchestrates: validation → strategy selection → levels → sizing → risk → RulesResult.
 * Ported from trading-agent/src/small-cap-trading/trading-rules.engine.ts
 */
export class TradingRulesEngine {
  private readonly hardStops = new HardStopsValidator();
  private readonly patternDetector = new PatternSignalsDetector();
  private readonly strategyFactory = new StrategyFactory();
  private readonly positionSizer = new PositionSizer();
  private readonly riskManager = new RiskManager();
  private readonly guidanceGen = new StrategyGuidanceGenerator();

  evaluate(ctx: MarketContext): RulesResult {
    const patternResult = this.patternDetector.detect(ctx);
    const strategyCtx = this.buildStrategyContext(ctx, patternResult);

    const validation = this.hardStops.validate(ctx);
    if (!validation.passed) {
      const strategy = this.strategyFactory.getStrategy(strategyCtx);
      const levels = strategy.getLevels(strategyCtx);
      const displayName = this.getDisplayStrategyName(strategy.name, ctx.session);
      return this.buildNoTradeResult(
        ctx.session, validation.failures, displayName, levels,
        patternResult.patterns, this.guidanceGen.generate(displayName),
      );
    }

    const strategy = this.strategyFactory.getStrategy(strategyCtx);
    const levels = strategy.getLevels(strategyCtx);
    const sizing = this.positionSizer.size(ctx.account_size, levels.entry, levels.stop, levels.target1);
    const riskResult = this.riskManager.validate(levels, sizing, ctx.account_size);

    const patternSignals = [...patternResult.signals, ...riskResult.warnings];
    const displayName = this.getDisplayStrategyName(strategy.name, ctx.session);

    return this.buildViableResult(
      ctx, displayName, patternSignals, levels, sizing,
      riskResult.warnings.length === 0, patternResult.patterns,
      this.guidanceGen.generate(displayName),
    );
  }

  private buildStrategyContext(ctx: MarketContext, pr: PatternDetectionResult): StrategyContext {
    return {
      ...ctx,
      bullFlagDetected: pr.bullFlagDetected,
      abcdDetected: pr.abcdDetected,
      orbDetected: pr.orbDetected,
      vwapReversalDetected: pr.vwapReversalDetected,
      fallenAngelDetected: pr.fallenAngelDetected,
      flatTopDetected: false,
      redToGreenDetected: false,
      halfWholeDollarDetected: false,
      microPullbackDetected: false,
      hodBreakDetected: false,
      nearHod: false,
      aboveVwap: !!(ctx.vwap && ctx.price > ctx.vwap),
      aboveEma9: !!(ctx.ema9 && ctx.price > ctx.ema9),
      aboveEma20: !!(ctx.ema20 && ctx.price > ctx.ema20),
      detectedPatterns: pr.patterns,
    };
  }

  private getDisplayStrategyName(strategyName: string, session: string): string {
    if (strategyName !== 'GENERAL') return strategyName;
    const key = session.startsWith('PRE_MARKET') ? 'PRE_MARKET'
      : session.startsWith('AFTER_HOURS') ? 'AFTER_HOURS'
      : session.split(' ')[0] ?? 'GENERAL';
    return key === 'PRE_MARKET' || key === 'AFTER_HOURS' ? key : `GENERAL · ${key}`;
  }

  private buildNoTradeResult(
    session: string, hardStops: string[], displayStrategy?: string,
    displayLevels?: StrategyLevels, patterns: PatternResult[] = [],
    guidance: StrategyGuidance | null = null,
  ): RulesResult {
    return {
      viable: false, session,
      identified_strategy: displayStrategy ?? null,
      pattern_signals: [], hard_stops: hardStops,
      entry_zone: displayLevels ? { price: displayLevels.entry, note: 'entry' } : null,
      stop_loss: displayLevels ? { price: displayLevels.stop, note: 'stop' } : null,
      target_1: displayLevels ? { price: displayLevels.target1, note: 'T1' } : null,
      target_2: displayLevels ? { price: displayLevels.target2, note: 'T2' } : null,
      share_size: null, risk_amount: null, rr_ratio: null,
      verdict: 'This stock does not meet minimum trading criteria. Do NOT trade.',
      detected_patterns: patterns, strategy_guidance: guidance,
    };
  }

  private buildViableResult(
    ctx: MarketContext, identifiedStrategy: string, patternSignals: string[],
    levels: StrategyLevels, sizing: { shareSize: number; maxRisk: number; rrRatio: number },
    riskPassed: boolean, patterns: PatternResult[] = [],
    guidance: StrategyGuidance | null = null,
  ): RulesResult {
    const verdict = riskPassed
      ? `Setup looks viable. Strategy: ${identifiedStrategy}. Entry near $${levels.entry.toFixed(2)}, stop at $${levels.stop.toFixed(2)}, T1 at $${levels.target1.toFixed(2)} (R/R ${sizing.rrRatio.toFixed(1)}:1). Max ${sizing.shareSize} shares.`
      : `Setup meets entry criteria but has risk warnings. Strategy: ${identifiedStrategy}. Review R/R and position size before trading.`;

    return {
      viable: true, session: ctx.session,
      identified_strategy: identifiedStrategy,
      pattern_signals: patternSignals, hard_stops: [],
      entry_zone: { price: levels.entry, note: `${identifiedStrategy} entry` },
      stop_loss: { price: levels.stop, note: 'Structural stop based on pattern' },
      target_1: { price: levels.target1, note: 'First target — take 50% off' },
      target_2: { price: levels.target2, note: 'Second target — let winners run' },
      share_size: sizing.shareSize, risk_amount: sizing.maxRisk,
      rr_ratio: sizing.rrRatio, verdict,
      detected_patterns: patterns, strategy_guidance: guidance,
    };
  }
}
