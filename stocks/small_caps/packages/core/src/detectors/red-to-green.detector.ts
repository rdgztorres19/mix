import type { Candle, PatternResult } from '@small-caps/shared';

export class RedToGreenDetector {
  detect(candles: Candle[]): PatternResult {
    const empty: PatternResult = { detected: false, name: 'RED_TO_GREEN', anchor_points: [], description: '' };
    if (candles.length < 3) return empty;

    // Find the first regular-hours candle (9:30 ET = 570 minutes)
    const firstRthCandle = this.findFirstRthCandle(candles);
    if (!firstRthCandle) return empty;

    const openPrice = firstRthCandle.o;
    const firstRthIdx = candles.indexOf(firstRthCandle);

    // Need at least one candle after the first RTH candle
    if (firstRthIdx >= candles.length - 1) return empty;

    // Check that some candles traded below the open price (was red)
    const candlesAfterOpen = candles.slice(firstRthIdx + 1);
    const tradedBelow = candlesAfterOpen.some((c) => c.l < openPrice || c.c < openPrice);
    if (!tradedBelow) return empty;

    // Current candle must close above the open price
    const current = candles[candles.length - 1];
    if (current.c <= openPrice) return empty;

    // Previous candle should have been below or at the open price (confirms crossover moment)
    const prev = candles[candles.length - 2];
    if (prev.c >= openPrice) return empty;

    return {
      detected: true,
      name: 'RED_TO_GREEN',
      anchor_points: [
        { label: 'OpenPrice', price: openPrice, time: firstRthCandle.t },
        { label: 'RedLow', price: Math.min(...candlesAfterOpen.map((c) => c.l)), time: current.t },
        { label: 'GreenClose', price: current.c, time: current.t },
      ],
      description: `Red to Green: open $${openPrice.toFixed(2)}, was red, now closing $${current.c.toFixed(2)} above open`,
    };
  }

  private findFirstRthCandle(candles: Candle[]): Candle | null {
    for (const c of candles) {
      const d = new Date(c.t);
      const etStr = d.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      });
      const [h, m] = etStr.split(':').map(Number);
      const totalMin = h * 60 + m;
      if (totalMin >= 570) return c; // 9:30 ET
    }
    return null;
  }
}
