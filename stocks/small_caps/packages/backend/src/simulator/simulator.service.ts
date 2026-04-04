import { Injectable } from '@nestjs/common';
import { ChartService } from '../chart/chart.service';
import {
  TradingRulesEngine,
  CandlestickPatternsDetector,
  SupportResistanceDetector,
  StrategyGuidanceGenerator,
  createDefaultRegistry,
  VwapCalculator,
  EmaCalculator,
  SmaCalculator,
  AtrCalculator,
  RsiCalculator,
} from '@small-caps/core';
import type {
  Candle, MarketContext, SimulationState, IndicatorValues,
  ActiveStrategy, CandlestickPattern, SRLevel,
} from '@small-caps/shared';

@Injectable()
export class SimulatorService {
  private readonly rulesEngine = new TradingRulesEngine();
  private readonly candlestickDetector = new CandlestickPatternsDetector();
  private readonly srDetector = new SupportResistanceDetector();
  private readonly guidanceGen = new StrategyGuidanceGenerator();
  private readonly registry = createDefaultRegistry();

  constructor(private readonly chartService: ChartService) {}

  async getSimulationState(
    symbol: string,
    date: string,
    candleIdx: number,
    source?: string,
  ): Promise<SimulationState> {
    // Load all candles for the day
    const allCandles = await this.chartService.getCandles(symbol, date, '1m');
    const maxIdx = allCandles.length - 1;
    const idx = Math.min(candleIdx, maxIdx);

    // Slice to current position
    const candles = allCandles.slice(0, idx + 1);
    if (!candles.length) {
      return this.emptyState(symbol, date, candleIdx, maxIdx);
    }

    // Compute indicators
    const closes = candles.map((c) => c.c);
    const indicators: IndicatorValues[] = candles.map((_, i) => {
      const slice = candles.slice(0, i + 1);
      const closesSlice = closes.slice(0, i + 1);
      return {
        vwap: VwapCalculator.calculate(slice),
        ema9: EmaCalculator.calculate(closesSlice, 9),
        ema20: EmaCalculator.calculate(closesSlice, 20),
        sma50: SmaCalculator.calculate(closesSlice, 50),
        sma200: SmaCalculator.calculate(closesSlice, 200),
        atr: AtrCalculator.calculate(slice),
        rsi: RsiCalculator.calculate(closesSlice),
      };
    });

    const lastIndicator = indicators[indicators.length - 1];
    const lastCandle = candles[candles.length - 1];

    // Build market context — pass only recent candles to detectors (last 30)
    // Detectors look at last 20 candles anyway, this prevents stale pattern detection
    const recentCandles = candles.slice(-30);

    const ctx: MarketContext = {
      ticker: symbol,
      price: lastCandle.c,
      vwap: lastIndicator.vwap,
      ema9: lastIndicator.ema9,
      ema20: lastIndicator.ema20,
      relative_volume: this.computeRelativeVolume(candles),
      change_pct: candles[0].o > 0 ? (lastCandle.c - candles[0].o) / candles[0].o : 0,
      atr: lastIndicator.atr,
      session: this.getSession(lastCandle.t),
      pre_market_high: this.getPreMarketHigh(candles),
      account_size: 25000,
      candles: recentCandles,
    };

    // Run rules engine
    const rulesResult = this.rulesEngine.evaluate(ctx);

    // Detect candlestick patterns
    const candlestickPatterns = this.candlestickDetector.detect(candles);

    // Detect S/R levels
    const srLevels = this.srDetector.detect({
      candles,
      preMarketHigh: ctx.pre_market_high ?? undefined,
    });

    // Compute WT-specific detection flags
    const hod = candles.reduce((max, c) => Math.max(max, c.h), 0);
    const nearHod = hod > 0 && ctx.price >= hod * 0.99;

    // Build extended strategy context with all flags
    const strategyCtx = {
      ...ctx,
      // Advanced Trading
      bullFlagDetected: rulesResult.detected_patterns.some((p) => p.name === 'BULL_FLAG'),
      abcdDetected: rulesResult.detected_patterns.some((p) => p.name === 'ABCD'),
      orbDetected: rulesResult.detected_patterns.some((p) => p.name === 'ORB'),
      vwapReversalDetected: rulesResult.detected_patterns.some((p) => p.name === 'VWAP_REVERSAL'),
      fallenAngelDetected: rulesResult.detected_patterns.some((p) => p.name === 'FALLEN_ANGEL'),
      // Warrior Trading (reuse existing detectors + simple inline checks)
      flatTopDetected: rulesResult.detected_patterns.some((p) => p.name === 'BULL_FLAG') && nearHod,
      redToGreenDetected: this.isRedToGreen(candles),
      halfWholeDollarDetected: this.isNearHalfWholeDollar(ctx.price),
      microPullbackDetected: this.isMicroPullback(recentCandles, ctx.ema9),
      hodBreakDetected: nearHod,
      // Computed
      aboveVwap: !!(ctx.vwap && ctx.price > ctx.vwap),
      aboveEma9: !!(ctx.ema9 && ctx.price > ctx.ema9),
      aboveEma20: !!(ctx.ema20 && ctx.price > ctx.ema20),
      nearHod,
      detectedPatterns: rulesResult.detected_patterns,
    };

    // Filter registry by source if specified, then evaluate first match
    let candidates = this.registry.getAll();
    if (source && source !== 'All') {
      candidates = this.registry.getBySource(source);
    }
    const firstMatch = candidates.find((reg) => reg.strategy.matches(strategyCtx)) ?? null;

    const activeStrategies: ActiveStrategy[] = firstMatch ? [{
      name: firstMatch.strategy.name,
      source: firstMatch.source,
      guidance: this.guidanceGen.generate(firstMatch.strategy.name) ?? {
        what_to_watch: '',
        confirmation_signals: [],
        invalidation: '',
        session_context: '',
        knowledge_summary: '',
      },
      levels: firstMatch.strategy.getLevels(strategyCtx),
      category: firstMatch.category,
    }] : [];

    return {
      symbol,
      date,
      candleIdx: idx,
      maxIdx,
      candles,
      indicators,
      activeStrategies,
      candlestickPatterns,
      supportResistanceLevels: srLevels,
      rulesResult,
    };
  }

  private emptyState(symbol: string, date: string, candleIdx: number, maxIdx: number): SimulationState {
    return {
      symbol, date, candleIdx, maxIdx,
      candles: [], indicators: [], activeStrategies: [],
      candlestickPatterns: [], supportResistanceLevels: [],
      rulesResult: {
        viable: false, session: '', identified_strategy: null,
        pattern_signals: [], hard_stops: ['No data'],
        entry_zone: null, stop_loss: null, target_1: null, target_2: null,
        share_size: null, risk_amount: null, rr_ratio: null,
        verdict: 'No candle data available.',
        detected_patterns: [], strategy_guidance: null,
      },
    };
  }

  private computeRelativeVolume(candles: Candle[]): number {
    if (candles.length < 2) return 1;
    const last = candles[candles.length - 1].v;
    const avg = candles.slice(0, -1).reduce((s, c) => s + c.v, 0) / (candles.length - 1);
    return avg > 0 ? last / avg : 1;
  }

  private getPreMarketHigh(candles: Candle[]): number | null {
    let pmHigh = 0;
    for (const c of candles) {
      const d = new Date(c.t);
      const etStr = d.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric', minute: 'numeric', hour12: false,
      });
      const [h, m] = etStr.split(':').map(Number);
      if (h * 60 + m < 570) {
        if (c.h > pmHigh) pmHigh = c.h;
      }
    }
    return pmHigh > 0 ? pmHigh : null;
  }

  private getSession(timestamp: number): string {
    const d = new Date(timestamp);
    const etStr = d.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric', minute: 'numeric', hour12: false,
    });
    const [h, m] = etStr.split(':').map(Number);
    const min = h * 60 + m;
    if (min < 570) return 'PRE_MARKET';
    if (min < 660) return 'THE_OPEN';
    if (min < 750) return 'LATE_MORNING';
    if (min < 840) return 'MIDDAY';
    if (min < 960) return 'THE_CLOSE';
    return 'AFTER_HOURS';
  }

  /** Red to Green: stock opened red (first candle was red), now price is above the open of first candle. */
  private isRedToGreen(candles: Candle[]): boolean {
    if (candles.length < 5) return false;
    const firstCandle = candles[0];
    const wasRed = firstCandle.c < firstCandle.o;
    if (!wasRed) return false;
    const current = candles[candles.length - 1];
    return current.c > firstCandle.o;
  }

  /** Price within 5 cents of a half or whole dollar. */
  private isNearHalfWholeDollar(price: number): boolean {
    const nearestHalf = Math.ceil(price * 2) / 2;
    return nearestHalf - price > 0 && nearestHalf - price <= 0.05;
  }

  /** Micro pullback: 1-2 red candles after 3+ green, still above EMA9. */
  private isMicroPullback(candles: Candle[], ema9: number | null): boolean {
    if (candles.length < 5 || !ema9) return false;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    // Last 1-2 candles red or doji
    const lastRed = last.c <= last.o;
    const prevRed = prev.c <= prev.o;
    if (!lastRed && !prevRed) return false;
    // Previous 3+ green
    let greenCount = 0;
    for (let i = candles.length - 3; i >= Math.max(0, candles.length - 6); i--) {
      if (candles[i].c > candles[i].o) greenCount++;
    }
    if (greenCount < 3) return false;
    // Still above ema9
    return last.c > ema9;
  }
}
