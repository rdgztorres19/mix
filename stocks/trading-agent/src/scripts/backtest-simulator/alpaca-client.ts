import type { AlpacaBar } from '../../scanner/screener/alpaca/alpaca-screener.client';

const BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEnvAny(keys: string[]): string {
  for (const k of keys) {
    const v = process.env[k];
    if (v) return v;
  }
  return '';
}

function marketDataHeaders(): HeadersInit {
  const key = getEnvAny(['ALPACA_API_KEY_ID', 'ALPACA_KEY_ID']);
  const secret = getEnvAny(['ALPACA_API_SECRET_KEY', 'ALPACA_SECRET_KEY']);
  return {
    'APCA-API-KEY-ID': key,
    'APCA-API-SECRET-KEY': secret,
    Accept: 'application/json',
  };
}

export class AlpacaClient {
  private readonly chunkSize: number;
  private readonly maxRetries: number;

  constructor() {
    this.chunkSize = parseInt(process.env.SCREENER_CHUNK_SIZE ?? '200', 10);
    this.maxRetries = parseInt(process.env.SCREENER_MAX_RETRIES ?? '20', 10);
  }

  async fetch1mBars(symbols: string[], date: string): Promise<Map<string, AlpacaBar[]>> {
    const result = new Map<string, AlpacaBar[]>();
    const chunks = this.chunk(symbols, this.chunkSize);

    for (let i = 0; i < chunks.length; i++) {
      console.log(`  [Alpaca] Fetching 1m bars chunk ${i + 1}/${chunks.length} (${chunks[i].length} symbols)...`);
      const chunkResult = await this.fetchBarsChunk(chunks[i], date, date, '1Min');
      for (const [sym, bars] of Object.entries(chunkResult)) {
        result.set(sym.toUpperCase(), bars);
      }
    }

    return result;
  }

  async fetchDailyBars(symbols: string[], date: string): Promise<Map<string, AlpacaBar[]>> {
    const result = new Map<string, AlpacaBar[]>();
    const chunks = this.chunk(symbols, 1000);

    for (let i = 0; i < chunks.length; i++) {
      console.log(`  [Alpaca] Fetching daily bars chunk ${i + 1}/${chunks.length} (${chunks[i].length} symbols)...`);
      const chunkResult = await this.fetchBarsChunk(chunks[i], date, date, '1Day');
      for (const [sym, bars] of Object.entries(chunkResult)) {
        result.set(sym.toUpperCase(), bars);
      }
    }

    return result;
  }

  private async fetchBarsChunk(
    symbols: string[],
    startDate: string,
    endDate: string,
    timeframe: string,
  ): Promise<Record<string, AlpacaBar[]>> {
    const merged: Record<string, AlpacaBar[]> = {};
    let pageToken: string | null = null;

    do {
      const params = new URLSearchParams({
        symbols: symbols.join(','),
        timeframe,
        start: `${startDate}T00:00:00Z`,
        end: `${endDate}T23:59:59Z`,
        adjustment: 'split',
        sort: 'asc',
        limit: '10000',
      });
      if (pageToken) params.set('page_token', pageToken);

      const data = await this.fetchWithRetry(`${BARS_URL}?${params}`);
      const bars = (data.bars ?? {}) as Record<string, AlpacaBar[]>;

      for (const [sym, barArr] of Object.entries(bars)) {
        const key = sym.toUpperCase();
        if (!merged[key]) merged[key] = [];
        merged[key].push(...barArr);
      }

      pageToken = (data.next_page_token as string) ?? null;
    } while (pageToken);

    return merged;
  }

  private async fetchWithRetry(url: string): Promise<Record<string, unknown>> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const res = await fetch(url, { headers: marketDataHeaders() });

      if (res.ok) return (await res.json()) as Record<string, unknown>;

      if (res.status === 429) {
        console.warn(`  [Alpaca] Rate limited (429). Waiting 60s... (attempt ${attempt})`);
        await sleep(60_000);
        continue;
      }

      if (res.status >= 500) {
        const wait = Math.min(5000 * attempt, 60_000);
        console.warn(`  [Alpaca] Server error ${res.status}. Retrying in ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }

      throw new Error(`Alpaca HTTP ${res.status}: ${await res.text()}`);
    }

    throw new Error(`Alpaca: max retries (${this.maxRetries}) exceeded`);
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }
}
