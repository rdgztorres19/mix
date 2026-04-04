import type { Candle, PatternResult } from '@small-caps/shared';

export class FallenAngelDetector {
  private readonly MIN_CANDLES = 6;

  detect(candles: Candle[], preMarketHigh: number | null): PatternResult {
    const empty: PatternResult = { detected: false, name: 'FALLEN_ANGEL', anchor_points: [], description: '' };
    if (candles.length < this.MIN_CANDLES) return empty;

    const earlyCandles = candles.slice(0, Math.min(15, candles.length));
    const hodCandle = earlyCandles.reduce((max, c) => (c.h > max.h ? c : max), earlyCandles[0]);
    const hod = hodCandle.h;

    const postHodCandles = candles.slice(earlyCandles.length);
    if (postHodCandles.length < 3) return empty;

    const selloffLow = Math.min(...postHodCandles.slice(0, 4).map((c) => c.l));
    const selloffPct = (hod - selloffLow) / hod;
    if (selloffPct < 0.05) return empty;

    const consolidation = postHodCandles.slice(-3);
    const consoHigh = Math.max(...consolidation.map((c) => c.h));
    const consoLow = Math.min(...consolidation.map((c) => c.l));
    const consoRange = consoHigh - consoLow;
    const avgRange = candles.reduce((s, c) => s + (c.h - c.l), 0) / candles.length;

    if (consoRange > avgRange * 1.5) return empty;

    const lastCandle = candles[candles.length - 1];
    const breakingUp = lastCandle.c > consoHigh || lastCandle.h > consoHigh;

    return {
      detected: true,
      name: 'FALLEN_ANGEL',
      anchor_points: [
        { label: 'HOD', price: hod, time: hodCandle.t },
        { label: 'SelloffLow', price: selloffLow, time: postHodCandles[Math.min(3, postHodCandles.length - 1)].t },
        { label: 'ConsoLow', price: consoLow, time: consolidation[0].t },
        { label: 'ConsoHigh', price: consoHigh, time: consolidation[consolidation.length - 1].t },
      ],
      description: `Fallen Angel: HOD $${hod.toFixed(2)} → selloff to $${selloffLow.toFixed(2)} (${(selloffPct * 100).toFixed(0)}%), consolidating $${consoLow.toFixed(2)}–$${consoHigh.toFixed(2)}${breakingUp ? ' — breakout starting' : ''}`,
    };
  }
}
