import type { CollectorCandle } from '../../collector/indicator.calculator';
import { timestampToET } from '../../collector/indicator.calculator';
import type { TradeResult, TpSlResult } from './types';

export type TradeDirection = 'long' | 'short';

export class TradeSimulator {
  private readonly targetPct: number;
  private readonly stopLossPct: number;
  private readonly lookAhead: number;
  private readonly direction: TradeDirection;

  constructor(targetPct: number, stopLossPct: number, lookAhead = 60, direction: TradeDirection = 'long') {
    this.targetPct = targetPct;
    this.stopLossPct = stopLossPct;
    this.lookAhead = lookAhead;
    this.direction = direction;
  }

  /**
   * Evaluate a trade signal by looking ahead in the candle history.
   * Long: TP = price goes UP, SL = price goes DOWN
   * Short: TP = price goes DOWN, SL = price goes UP
   */
  evaluate(allCandles: CollectorCandle[], entryIdx: number): TradeResult {
    const entryCandle = allCandles[entryIdx];
    if (!entryCandle) {
      return { result: 'neutral', entryPrice: 0, pnlPct: 0 };
    }

    const entryPrice = entryCandle.c;
    if (entryPrice <= 0) {
      return { result: 'neutral', entryPrice, pnlPct: 0 };
    }

    const tpDec = this.targetPct / 100;
    const slDec = this.stopLossPct / 100;

    // Long: TP above, SL below. Short: TP below, SL above.
    const tpLevel = this.direction === 'long'
      ? entryPrice * (1 + tpDec)
      : entryPrice * (1 - tpDec);
    const slLevel = this.direction === 'long'
      ? entryPrice * (1 - slDec)
      : entryPrice * (1 + slDec);

    let prevClose = entryPrice;
    const n = Math.min(this.lookAhead, allCandles.length - entryIdx - 1);

    for (let j = 1; j <= n; j++) {
      const c = allCandles[entryIdx + j];
      if (!c) break;

      const openJ = c.o;
      const highJ = c.h;
      const lowJ = c.l;
      const closeJ = c.c;

      if (this.direction === 'long') {
        // Long: TP hit when high >= tpLevel, SL hit when low <= slLevel
        // Gap up through TP
        if (prevClose < openJ && prevClose < tpLevel && tpLevel < openJ) {
          return this.buildResult('win', entryPrice, tpLevel, c);
        }
        // Gap down through SL
        if (prevClose > openJ && openJ < slLevel && slLevel < prevClose) {
          return this.buildResult('loss', entryPrice, slLevel, c);
        }

        const touchTp = highJ >= tpLevel;
        const touchSl = lowJ <= slLevel;

        if (touchTp && touchSl) {
          const hit: TpSlResult = closeJ >= openJ ? 'loss' : 'win';
          const price = closeJ >= openJ ? slLevel : tpLevel;
          return this.buildResult(hit, entryPrice, price, c);
        }
        if (touchTp) return this.buildResult('win', entryPrice, tpLevel, c);
        if (touchSl) return this.buildResult('loss', entryPrice, slLevel, c);
      } else {
        // Short: TP hit when low <= tpLevel, SL hit when high >= slLevel
        // Gap down through TP
        if (prevClose > openJ && openJ < tpLevel && tpLevel < prevClose) {
          return this.buildResult('win', entryPrice, tpLevel, c);
        }
        // Gap up through SL
        if (prevClose < openJ && prevClose < slLevel && slLevel < openJ) {
          return this.buildResult('loss', entryPrice, slLevel, c);
        }

        const touchTp = lowJ <= tpLevel;
        const touchSl = highJ >= slLevel;

        if (touchTp && touchSl) {
          // Both hit same candle: green candle (up) = SL hit first, red candle (down) = TP hit first
          const hit: TpSlResult = closeJ >= openJ ? 'loss' : 'win';
          const price = closeJ >= openJ ? slLevel : tpLevel;
          return this.buildResult(hit, entryPrice, price, c);
        }
        if (touchTp) return this.buildResult('win', entryPrice, tpLevel, c);
        if (touchSl) return this.buildResult('loss', entryPrice, slLevel, c);
      }

      prevClose = closeJ;
    }

    return { result: 'neutral', entryPrice, pnlPct: 0 };
  }

  private buildResult(
    result: TpSlResult,
    entryPrice: number,
    exitPrice: number,
    candle: CollectorCandle,
  ): TradeResult {
    // Long: profit when exit > entry. Short: profit when exit < entry.
    const pnlPct = this.direction === 'long'
      ? ((exitPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - exitPrice) / entryPrice) * 100;
    return {
      result,
      entryPrice,
      exitPrice,
      exitMinute: timestampToET(candle.t).time,
      pnlPct,
    };
  }
}
