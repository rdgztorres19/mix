import type { Candle, CandlestickPattern } from '@small-caps/shared';

/**
 * Detects classic candlestick patterns from the "Advanced Trading" book:
 * Doji, Shooting Star, Hammer, Bullish/Bearish Engulfing, HH/HL, LL/LH
 */
export class CandlestickPatternsDetector {
  detect(candles: Candle[]): CandlestickPattern[] {
    const patterns: CandlestickPattern[] = [];
    if (candles.length < 2) return patterns;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const range = c.h - c.l;
      if (range <= 0) continue;

      const body = Math.abs(c.c - c.o);
      const upperWick = c.h - Math.max(c.o, c.c);
      const lowerWick = Math.min(c.o, c.c) - c.l;

      // Doji: body < 10% of range
      if (body / range < 0.1) {
        patterns.push({
          name: 'Doji',
          candleIdx: i,
          significance: 'neutral',
          description: `Doji: indecision, body ${(body / range * 100).toFixed(0)}% of range`,
        });
      }

      // Shooting Star: upper wick > 2× body, small body at bottom third
      if (upperWick > body * 2 && lowerWick < body && body / range < 0.33) {
        patterns.push({
          name: 'Shooting Star',
          candleIdx: i,
          significance: 'bearish',
          description: 'Shooting Star: long upper wick, buyers failed to hold highs',
        });
      }

      // Hammer: lower wick > 2× body, small body at top third
      if (lowerWick > body * 2 && upperWick < body && body / range < 0.33) {
        patterns.push({
          name: 'Hammer',
          candleIdx: i,
          significance: 'bullish',
          description: 'Hammer: long lower wick, sellers failed to push lower',
        });
      }

      // Engulfing patterns (need previous candle)
      if (i > 0) {
        const prev = candles[i - 1];
        const prevBody = Math.abs(prev.c - prev.o);
        const prevIsRed = prev.c < prev.o;
        const curIsGreen = c.c > c.o;
        const curIsRed = c.c < c.o;
        const prevIsGreen = prev.c > prev.o;

        // Bullish Engulfing: previous red, current green body engulfs previous body
        if (prevIsRed && curIsGreen && body > prevBody &&
            Math.min(c.o, c.c) <= Math.min(prev.o, prev.c) &&
            Math.max(c.o, c.c) >= Math.max(prev.o, prev.c)) {
          patterns.push({
            name: 'Bullish Engulfing',
            candleIdx: i,
            significance: 'bullish',
            description: 'Bullish Engulfing: green candle completely engulfs previous red candle',
          });
        }

        // Bearish Engulfing: previous green, current red body engulfs previous body
        if (prevIsGreen && curIsRed && body > prevBody &&
            Math.min(c.o, c.c) <= Math.min(prev.o, prev.c) &&
            Math.max(c.o, c.c) >= Math.max(prev.o, prev.c)) {
          patterns.push({
            name: 'Bearish Engulfing',
            candleIdx: i,
            significance: 'bearish',
            description: 'Bearish Engulfing: red candle completely engulfs previous green candle',
          });
        }
      }
    }

    // Higher Highs / Higher Lows (look at last 5 candles)
    if (candles.length >= 3) {
      const recent = candles.slice(-5);
      let hhCount = 0, hlCount = 0, llCount = 0, lhCount = 0;
      for (let i = 1; i < recent.length; i++) {
        if (recent[i].h > recent[i - 1].h) hhCount++;
        if (recent[i].l > recent[i - 1].l) hlCount++;
        if (recent[i].l < recent[i - 1].l) llCount++;
        if (recent[i].h < recent[i - 1].h) lhCount++;
      }

      if (hhCount >= 2 && hlCount >= 2) {
        patterns.push({
          name: 'Higher Highs & Higher Lows',
          candleIdx: candles.length - 1,
          significance: 'bullish',
          description: `HH/HL pattern: ${hhCount} higher highs, ${hlCount} higher lows in last ${recent.length} candles`,
        });
      }

      if (llCount >= 2 && lhCount >= 2) {
        patterns.push({
          name: 'Lower Lows & Lower Highs',
          candleIdx: candles.length - 1,
          significance: 'bearish',
          description: `LL/LH pattern: ${llCount} lower lows, ${lhCount} lower highs in last ${recent.length} candles`,
        });
      }
    }

    return patterns;
  }
}
