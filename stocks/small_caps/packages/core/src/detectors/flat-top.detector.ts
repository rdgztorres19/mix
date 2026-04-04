import type { Candle, PatternResult } from '@small-caps/shared';

export class FlatTopDetector {
  private readonly MIN_GREEN_RUN = 3;
  private readonly MIN_CONSOLIDATION = 2;
  private readonly TIGHT_RANGE_PCT = 0.003; // 0.3% of price
  private readonly HOD_TOLERANCE_PCT = 0.005; // 0.5% from HOD

  detect(candles: Candle[], highOfDay: number): PatternResult {
    const empty: PatternResult = { detected: false, name: 'FLAT_TOP', anchor_points: [], description: '' };
    if (candles.length < this.MIN_GREEN_RUN + this.MIN_CONSOLIDATION) return empty;

    // Work backwards: find consolidation candles at the end, then green run before them
    for (let consEnd = candles.length - 1; consEnd >= this.MIN_GREEN_RUN + this.MIN_CONSOLIDATION - 1; consEnd--) {
      // Try different consolidation lengths (2..5)
      for (let consLen = this.MIN_CONSOLIDATION; consLen <= Math.min(5, consEnd - this.MIN_GREEN_RUN + 1); consLen++) {
        const consStart = consEnd - consLen + 1;
        const consolidation = candles.slice(consStart, consEnd + 1);
        const greenRun = candles.slice(Math.max(0, consStart - this.MIN_GREEN_RUN), consStart);

        if (greenRun.length < this.MIN_GREEN_RUN) continue;

        // Validate green run: all candles green and moving up
        const allGreen = greenRun.every((c) => c.c > c.o);
        if (!allGreen) continue;
        const runningUp = greenRun[greenRun.length - 1].c > greenRun[0].o;
        if (!runningUp) continue;

        // Validate consolidation: tight range
        const consHighs = consolidation.map((c) => c.h);
        const consLows = consolidation.map((c) => c.l);
        const consHigh = Math.max(...consHighs);
        const consLow = Math.min(...consLows);
        const consRange = consHigh - consLow;
        const midPrice = (consHigh + consLow) / 2;

        if (midPrice <= 0) continue;
        if (consRange / midPrice > this.TIGHT_RANGE_PCT) continue;

        // Flat top must be at or near HOD
        if (highOfDay <= 0) continue;
        const distFromHod = Math.abs(consHigh - highOfDay) / highOfDay;
        if (distFromHod > this.HOD_TOLERANCE_PCT) continue;

        return {
          detected: true,
          name: 'FLAT_TOP',
          anchor_points: [
            { label: 'RunStart', price: greenRun[0].o, time: greenRun[0].t },
            { label: 'FlatTop', price: consHigh, time: consolidation[0].t },
            { label: 'FlatBottom', price: consLow, time: consolidation[consolidation.length - 1].t },
          ],
          description: `Flat Top: ${greenRun.length} green candles → ${consolidation.length} candles consolidating within $${consRange.toFixed(2)} (${((consRange / midPrice) * 100).toFixed(2)}%) at $${consHigh.toFixed(2)}, HOD $${highOfDay.toFixed(2)}`,
        };
      }
    }

    return empty;
  }
}
