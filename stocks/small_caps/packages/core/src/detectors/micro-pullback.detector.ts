import type { Candle, PatternResult } from '@small-caps/shared';

export class MicroPullbackDetector {
  private readonly MIN_GREEN_RUN = 3;
  private readonly MAX_PULLBACK_CANDLES = 2;

  detect(candles: Candle[], ema9: number | null): PatternResult {
    const empty: PatternResult = { detected: false, name: 'MICRO_PULLBACK', anchor_points: [], description: '' };
    if (candles.length < this.MIN_GREEN_RUN + 1) return empty;

    const current = candles[candles.length - 1];

    // Must be above EMA9 if provided
    if (ema9 !== null && current.c < ema9) return empty;

    // Find pullback candles at the end (1-2 red or doji candles)
    let pullbackCount = 0;
    for (let i = candles.length - 1; i >= candles.length - this.MAX_PULLBACK_CANDLES && i >= 0; i--) {
      const c = candles[i];
      const isRedOrDoji = c.c <= c.o;
      if (isRedOrDoji) {
        pullbackCount++;
      } else {
        break;
      }
    }

    if (pullbackCount < 1) return empty;

    // Check green run before the pullback
    const greenRunEnd = candles.length - 1 - pullbackCount;
    if (greenRunEnd < this.MIN_GREEN_RUN - 1) return empty;

    const greenRunStart = Math.max(0, greenRunEnd - this.MIN_GREEN_RUN + 1);
    const greenRun = candles.slice(greenRunStart, greenRunEnd + 1);

    // All green run candles must be green
    const allGreen = greenRun.every((c) => c.c > c.o);
    if (!allGreen) return empty;
    if (greenRun.length < this.MIN_GREEN_RUN) return empty;

    // Green run should have increasing or strong volume
    let greenVolIncreasing = true;
    for (let i = 1; i < greenRun.length; i++) {
      if (greenRun[i].v < greenRun[i - 1].v * 0.7) {
        greenVolIncreasing = false;
        break;
      }
    }
    if (!greenVolIncreasing) return empty;

    // Pullback volume should be decreasing relative to the green run
    const pullbackCandles = candles.slice(candles.length - pullbackCount);
    const avgGreenVol = greenRun.reduce((s, c) => s + c.v, 0) / greenRun.length;
    const avgPullbackVol = pullbackCandles.reduce((s, c) => s + c.v, 0) / pullbackCandles.length;
    if (avgPullbackVol >= avgGreenVol) return empty;

    const greenMoveStart = greenRun[0].o;
    const greenMoveEnd = greenRun[greenRun.length - 1].c;
    const ema9Str = ema9 !== null ? `, EMA9 $${ema9.toFixed(2)}` : '';

    return {
      detected: true,
      name: 'MICRO_PULLBACK',
      anchor_points: [
        { label: 'GreenStart', price: greenMoveStart, time: greenRun[0].t },
        { label: 'GreenEnd', price: greenMoveEnd, time: greenRun[greenRun.length - 1].t },
        { label: 'PullbackLow', price: Math.min(...pullbackCandles.map((c) => c.l)), time: current.t },
      ],
      description: `Micro Pullback: ${greenRun.length} green candles ($${greenMoveStart.toFixed(2)}→$${greenMoveEnd.toFixed(2)}), ${pullbackCount} red candle(s) on lower volume${ema9Str}`,
    };
  }
}
