/**
 * Fundamentals cache — shares_outstanding, market_cap.
 * Duplicated from stock-training/src/data/fundamental-fetcher.ts - keep in sync.
 * Cache key: symbol (fundamentals don't change intraday).
 * Used by sync-symbol-date and sync-date to populate rows when no candle has them.
 */

import * as path from 'path';
import axios from 'axios';

export interface Fundamentals {
  sharesOutstanding: number | null;
  marketCap: number | null;
}

const cache = new Map<string, Fundamentals>();
let envLoaded = false;

const EMPTY: Fundamentals = { sharesOutstanding: null, marketCap: null };

function ensureFinnhubKeyLoaded(): void {
  if (envLoaded || process.env.FINNHUB_API_KEY) return;
  envLoaded = true;
  try {
    const dotenv = require('dotenv');
    const stockTrainingEnv = path.resolve(process.cwd(), '..', 'stock-training', '.env');
    dotenv.config({ path: stockTrainingEnv });
  } catch {
    /* ignore */
  }
}

async function fetchFromFinnhub(ticker: string, token: string): Promise<Fundamentals> {
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${token}`;
  const res = await axios.get(url, { timeout: 8000 });
  const profile = res.data ?? {};

  const so = profile.shareOutstanding ?? profile.share_outstanding;
  const soNum = typeof so === 'number' ? so : typeof so === 'string' ? parseFloat(so) : NaN;
  const sharesOutstanding =
    !isNaN(soNum) && soNum > 0 ? soNum * 1_000_000 : null;

  const mc = profile.marketCapitalization ?? profile.market_capitalization;
  const mcNum = typeof mc === 'number' ? mc : typeof mc === 'string' ? parseFloat(mc) : NaN;
  const marketCap = !isNaN(mcNum) && mcNum > 0 ? mcNum : null;

  return { sharesOutstanding, marketCap };
}

/**
 * Get fundamentals for symbol. Uses cache; on miss fetches from Finnhub.
 * Tries FINNHUB_API_KEY from env; falls back to ../stock-training/.env.
 * Returns EMPTY if no token or fetch fails.
 */
export async function getFundamentals(symbol: string): Promise<Fundamentals> {
  const key = symbol.toUpperCase();
  const cached = cache.get(key);
  if (cached) return cached;

  ensureFinnhubKeyLoaded();
  const token = process.env.FINNHUB_API_KEY?.trim();
  if (!token) {
    cache.set(key, EMPTY);
    return EMPTY;
  }

  try {
    const result = await fetchFromFinnhub(key, token);
    cache.set(key, result);
    return result;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) throw err;
    cache.set(key, EMPTY);
    return EMPTY;
  }
}
