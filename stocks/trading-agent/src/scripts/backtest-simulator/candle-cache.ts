import type { CollectorCandle } from '../../collector/indicator.calculator';
import type { AlpacaBar } from '../../scanner/screener/alpaca/alpaca-screener.client';
import type { AlpacaClient } from './alpaca-client';

export class CandleCache {
  private cache = new Map<string, CollectorCandle[]>();

  get symbols(): string[] {
    return [...this.cache.keys()];
  }

  has(symbol: string): boolean {
    return this.cache.has(symbol.toUpperCase());
  }

  async ensureSymbols(symbols: string[], date: string, client: AlpacaClient): Promise<void> {
    const upper = symbols.map((s) => s.toUpperCase());
    const missing = upper.filter((s) => !this.cache.has(s));

    if (missing.length > 0) {
      console.log(`  [Cache] Fetching 1m bars for ${missing.length} new symbols...`);
      const bars = await client.fetch1mBars(missing, date);
      for (const [sym, barArr] of bars) {
        this.cache.set(sym, alpacaBarsToCandles(barArr));
      }
    }

    // Evict symbols no longer in the combined list
    for (const sym of this.cache.keys()) {
      if (!upper.includes(sym)) this.cache.delete(sym);
    }
  }

  loadFromBars(barsMap: Map<string, AlpacaBar[]>): void {
    for (const [sym, bars] of barsMap) {
      this.cache.set(sym.toUpperCase(), alpacaBarsToCandles(bars));
    }
  }

  getCandlesUpTo(symbol: string, currentTimeMs: number): CollectorCandle[] {
    const all = this.cache.get(symbol.toUpperCase());
    if (!all) return [];
    return all.filter((c) => c.t <= currentTimeMs);
  }

  getAllCandles(symbol: string): CollectorCandle[] {
    return this.cache.get(symbol.toUpperCase()) ?? [];
  }
}

function alpacaBarsToCandles(bars: AlpacaBar[]): CollectorCandle[] {
  return bars.map((b) => ({
    o: b.o,
    h: b.h,
    l: b.l,
    c: b.c,
    v: b.v,
    t: new Date(b.t).getTime(),
  }));
}
