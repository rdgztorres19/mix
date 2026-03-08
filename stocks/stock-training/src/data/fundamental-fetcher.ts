/**
 * Fundamental data fetcher.
 * Uses Finnhub profile2: shareOutstanding, marketCapitalization.
 * Caché en memoria por ticker.
 */

import axios from 'axios';

export interface Fundamentals {
  sharesOutstanding: number | null;
  marketCap: number | null;
  previousClose: number | null;
}

const cache = new Map<string, Fundamentals>();

const EMPTY: Fundamentals = { sharesOutstanding: null, marketCap: null, previousClose: null };

/** Finnhub profile2: shareOutstanding (millions), marketCapitalization (millions). */
async function fetchFromProfile2(ticker: string, token: string): Promise<Fundamentals> {
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${token}`;
  const res = await axios.get(url, { timeout: 8000 });
  const profile = res.data ?? {};

  const so = profile.shareOutstanding;
  const sharesOutstanding = typeof so === 'number' && !isNaN(so) ? so * 1_000_000 : null;

  const mc = profile.marketCapitalization;
  const marketCap = typeof mc === 'number' && !isNaN(mc) ? mc : null;

  return { ...EMPTY, sharesOutstanding, marketCap };
}

export async function fetchFundamentals(ticker: string): Promise<Fundamentals> {
  const key = ticker.toUpperCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) {
    console.warn(`[fundamentals] FINNHUB_API_KEY no definido. Añade tu token en .env`);
    cache.set(key, EMPTY);
    return EMPTY;
  }

  try {
    const result = await fetchFromProfile2(key, token);
    cache.set(key, result);
    return result;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) throw err;
    console.warn(`[fundamentals] ${key}:`, err instanceof Error ? err.message : err);
    cache.set(key, EMPTY);
    return EMPTY;
  }
}
