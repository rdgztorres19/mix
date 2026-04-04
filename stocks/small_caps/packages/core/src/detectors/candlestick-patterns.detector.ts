import type { Candle, CandlestickPattern } from '@small-caps/shared';

/**
 * Detects candlestick patterns — only significant ones to reduce noise.
 * Requires minimum candle size and checks context (trend) before flagging.
 */
export class CandlestickPatternsDetector {
  detect(candles: Candle[]): CandlestickPattern[] {
    const patterns: CandlestickPattern[] = [];
    if (candles.length < 5) return patterns;

    // Only analyze the last 30 candles to avoid flooding with ancient patterns
    const startIdx = Math.max(0, candles.length - 30);

    // Compute average range for significance filter
    const ranges = candles.slice(startIdx).map((c) => c.h - c.l).filter((r) => r > 0);
    const avgRange = ranges.length > 0 ? ranges.reduce((s, v) => s + v, 0) / ranges.length : 0;
    const minSignificantRange = avgRange * 0.5; // Candle must be at least 50% of avg range

    for (let i = startIdx; i < candles.length; i++) {
      const c = candles[i];
      const range = c.h - c.l;
      if (range <= 0 || range < minSignificantRange) continue;

      const body = Math.abs(c.c - c.o);
      const upperWick = c.h - Math.max(c.o, c.c);
      const lowerWick = Math.min(c.o, c.c) - c.l;

      // Doji: body < 10% of range — only if range is significant
      if (body / range < 0.1 && range >= avgRange * 0.7) {
        patterns.push({
          name: 'Doji',
          candleIdx: i,
          significance: 'neutral',
          description: `Doji: indecision, body ${(body / range * 100).toFixed(0)}% of range`,
        });
      }

      // Shooting Star: upper wick > 2.5x body, small body at bottom — only after uptrend
      if (upperWick > body * 2.5 && lowerWick < body * 0.5 && body / range < 0.25 && i >= 3) {
        const prevCandles = candles.slice(i - 3, i);
        const uptrend = prevCandles.every((p, idx) => idx === 0 || p.c >= prevCandles[idx - 1].c);
        if (uptrend) {
          patterns.push({
            name: 'Shooting Star',
            candleIdx: i,
            significance: 'bearish',
            description: 'Shooting Star: long upper wick after uptrend, buyers failed',
          });
        }
      }

      // Hammer: lower wick > 2.5x body, small body at top — only after downtrend
      if (lowerWick > body * 2.5 && upperWick < body * 0.5 && body / range < 0.25 && i >= 3) {
        const prevCandles = candles.slice(i - 3, i);
        const downtrend = prevCandles.every((p, idx) => idx === 0 || p.c <= prevCandles[idx - 1].c);
        if (downtrend) {
          patterns.push({
            name: 'Hammer',
            candleIdx: i,
            significance: 'bullish',
            description: 'Hammer: long lower wick after downtrend, sellers failed',
          });
        }
      }

      // Engulfing patterns — require body > 1.5x prev body for significance
      if (i > 0) {
        const prev = candles[i - 1];
        const prevBody = Math.abs(prev.c - prev.o);
        if (prevBody <= 0) continue;

        const prevIsRed = prev.c < prev.o;
        const curIsGreen = c.c > c.o;
        const curIsRed = c.c < c.o;
        const prevIsGreen = prev.c > prev.o;

        // Bullish Engulfing: prev red, current green, body engulfs, and body > 1.5x prev
        if (prevIsRed && curIsGreen && body > prevBody * 1.5 &&
            Math.min(c.o, c.c) <= Math.min(prev.o, prev.c) &&
            Math.max(c.o, c.c) >= Math.max(prev.o, prev.c)) {
          patterns.push({
            name: 'Bullish Engulfing',
            candleIdx: i,
            significance: 'bullish',
            description: 'Bullish Engulfing: green candle engulfs previous red (strong buyer takeover)',
          });
        }

        // Bearish Engulfing: prev green, current red, body engulfs, and body > 1.5x prev
        if (prevIsGreen && curIsRed && body > prevBody * 1.5 &&
            Math.min(c.o, c.c) <= Math.min(prev.o, prev.c) &&
            Math.max(c.o, c.c) >= Math.max(prev.o, prev.c)) {
          patterns.push({
            name: 'Bearish Engulfing',
            candleIdx: i,
            significance: 'bearish',
            description: 'Bearish Engulfing: red candle engulfs previous green (strong seller takeover)',
          });
        }
      }
    }

    // HH/HL and LL/LH — only on last 5 candles
    if (candles.length >= 5) {
      const recent = candles.slice(-5);
      let hhCount = 0, hlCount = 0, llCount = 0, lhCount = 0;
      for (let i = 1; i < recent.length; i++) {
        if (recent[i].h > recent[i - 1].h) hhCount++;
        if (recent[i].l > recent[i - 1].l) hlCount++;
        if (recent[i].l < recent[i - 1].l) llCount++;
        if (recent[i].h < recent[i - 1].h) lhCount++;
      }

      if (hhCount >= 3 && hlCount >= 3) {
        patterns.push({
          name: 'Higher Highs & Higher Lows',
          candleIdx: candles.length - 1,
          significance: 'bullish',
          description: `HH/HL: ${hhCount}/${hlCount} in last 5 candles — strong uptrend`,
        });
      }

      if (llCount >= 3 && lhCount >= 3) {
        patterns.push({
          name: 'Lower Lows & Lower Highs',
          candleIdx: candles.length - 1,
          significance: 'bearish',
          description: `LL/LH: ${llCount}/${lhCount} in last 5 candles — strong downtrend`,
        });
      }
    }

    return patterns;
  }
}
