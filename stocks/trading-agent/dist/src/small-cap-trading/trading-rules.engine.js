"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradingRulesEngine = void 0;
const hard_stops_validator_1 = require("./validation/hard-stops.validator");
const pattern_signals_detector_1 = require("./validation/pattern-signals.detector");
const strategy_factory_1 = require("./strategies/strategy.factory");
const position_sizer_1 = require("./position-sizing/position-sizer");
const risk_manager_1 = require("./risk-management/risk-manager");
const strategy_guidance_generator_1 = require("./strategy-guidance.generator");
class TradingRulesEngine {
    constructor() {
        this.hardStops = new hard_stops_validator_1.HardStopsValidator();
        this.patternDetector = new pattern_signals_detector_1.PatternSignalsDetector();
        this.strategyFactory = new strategy_factory_1.StrategyFactory();
        this.positionSizer = new position_sizer_1.PositionSizer();
        this.riskManager = new risk_manager_1.RiskManager();
        this.guidanceGen = new strategy_guidance_generator_1.StrategyGuidanceGenerator();
    }
    evaluate(ctx) {
        const patternResult = this.patternDetector.detect(ctx);
        const strategyCtx = this.buildStrategyContext(ctx, patternResult);
        const validation = this.hardStops.validate(ctx);
        if (!validation.passed) {
            const strategy = this.strategyFactory.getStrategy(strategyCtx);
            const levels = strategy.getLevels(strategyCtx);
            const displayName = this.getDisplayStrategyName(strategy.name, ctx.session);
            return this.buildNoTradeResult(ctx.session, validation.failures, displayName, levels, patternResult.patterns, this.guidanceGen.generate(displayName));
        }
        const strategy = this.strategyFactory.getStrategy(strategyCtx);
        const levels = strategy.getLevels(strategyCtx);
        const sizing = this.positionSizer.size(ctx.account_size, levels.entry, levels.stop, levels.target1);
        const riskResult = this.riskManager.validate(levels, sizing, ctx.account_size);
        const patternSignals = [...patternResult.signals, ...riskResult.warnings];
        const displayName = this.getDisplayStrategyName(strategy.name, ctx.session);
        return this.buildViableResult(ctx, displayName, patternSignals, levels, sizing, riskResult.warnings.length === 0, patternResult.patterns, this.guidanceGen.generate(displayName));
    }
    buildStrategyContext(ctx, pr) {
        return {
            ...ctx,
            bullFlagDetected: pr.bullFlagDetected,
            abcdDetected: pr.abcdDetected,
            orbDetected: pr.orbDetected,
            vwapReversalDetected: pr.vwapReversalDetected,
            fallenAngelDetected: pr.fallenAngelDetected,
            aboveVwap: !!(ctx.vwap && ctx.price > ctx.vwap),
            aboveEma9: !!(ctx.ema9 && ctx.price > ctx.ema9),
            aboveEma20: !!(ctx.ema20 && ctx.price > ctx.ema20),
            detectedPatterns: pr.patterns,
        };
    }
    getDisplayStrategyName(strategyName, session) {
        if (strategyName !== 'GENERAL')
            return strategyName;
        const key = session.startsWith('PRE_MARKET') ? 'PRE_MARKET'
            : session.startsWith('AFTER_HOURS') ? 'AFTER_HOURS'
                : session.split(' ')[0] ?? 'GENERAL';
        return key === 'PRE_MARKET' || key === 'AFTER_HOURS' ? key : `GENERAL · ${key}`;
    }
    buildNoTradeResult(session, hardStops, displayStrategy, displayLevels, patterns = [], guidance = null) {
        return {
            viable: false,
            session,
            identified_strategy: displayStrategy ?? null,
            pattern_signals: [],
            hard_stops: hardStops,
            entry_zone: displayLevels ? { price: displayLevels.entry, note: 'entry' } : null,
            stop_loss: displayLevels ? { price: displayLevels.stop, note: 'stop' } : null,
            target_1: displayLevels ? { price: displayLevels.target1, note: 'T1' } : null,
            target_2: displayLevels ? { price: displayLevels.target2, note: 'T2' } : null,
            share_size: null,
            risk_amount: null,
            rr_ratio: null,
            verdict: 'This stock does not meet minimum trading criteria. Do NOT trade.',
            detected_patterns: patterns,
            strategy_guidance: guidance,
        };
    }
    buildViableResult(ctx, identifiedStrategy, patternSignals, levels, sizing, riskPassed, patterns = [], guidance = null) {
        const verdict = riskPassed
            ? `Setup looks viable. Strategy: ${identifiedStrategy}. Entry near $${levels.entry.toFixed(2)}, stop at $${levels.stop.toFixed(2)}, T1 at $${levels.target1.toFixed(2)} (R/R ${sizing.rrRatio.toFixed(1)}:1). Max ${sizing.shareSize} shares.`
            : `Setup meets entry criteria but has risk warnings. Strategy: ${identifiedStrategy}. Review R/R and position size before trading.`;
        return {
            viable: true,
            session: ctx.session,
            identified_strategy: identifiedStrategy,
            pattern_signals: patternSignals,
            hard_stops: [],
            entry_zone: { price: levels.entry, note: `${identifiedStrategy} entry` },
            stop_loss: { price: levels.stop, note: 'Structural stop based on pattern' },
            target_1: {
                price: levels.target1,
                note: 'First target — take 50% off',
            },
            target_2: {
                price: levels.target2,
                note: 'Second target — let winners run',
            },
            share_size: sizing.shareSize,
            risk_amount: sizing.maxRisk,
            rr_ratio: sizing.rrRatio,
            verdict,
            detected_patterns: patterns,
            strategy_guidance: guidance,
        };
    }
}
exports.TradingRulesEngine = TradingRulesEngine;
//# sourceMappingURL=trading-rules.engine.js.map