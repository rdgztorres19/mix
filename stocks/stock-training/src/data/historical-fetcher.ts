import axios from 'axios';
import type { Candle } from '../types';

/**
 * Fetches 1-min candles for a ticker.
 * Priority: Alpaca (if keys set) → Polygon → Yahoo.
 * Alpaca/Polygon: professional data, better quality than Yahoo.
 */
export async function fetch1MinCandles(
  ticker: string,
  dateStr: string,
): Promise<Candle[]> {
  const tickerUpper = ticker.toUpperCase();

  // 1. Alpaca (free tier, 7+ years historical, professional data)
  const alpacaKey = process.env.ALPACA_API_KEY_ID || process.env.APCA_API_KEY_ID;
  const alpacaSecret = process.env.ALPACA_API_SECRET_KEY || process.env.APCA_API_SECRET_KEY;
  if (alpacaKey && alpacaSecret) {
    console.log(`[fetch1Min] ${tickerUpper} ${dateStr} → usando Alpaca`);
    const candles = await fetchAlpaca1Min(tickerUpper, dateStr, alpacaKey, alpacaSecret);
    if (candles.length > 0) return candles;
  }

  // 2. Polygon.io (if API key set)
  const polygonKey = process.env.POLYGON_API_KEY;
  if (polygonKey) {
    console.log(`[fetch1Min] ${tickerUpper} ${dateStr} → usando Polygon`);
    const candles = await fetchPolygon1Min(tickerUpper, dateStr, polygonKey);
    if (candles.length > 0) return candles;
  }

  // 3. Yahoo Finance (fallback, limited ~7 days, variable quality)
  console.log(`[fetch1Min] ${tickerUpper} ${dateStr} → usando Yahoo Finance`);
  const candles = await fetchYahoo1Min(tickerUpper, dateStr);
  if (candles.length > 0) return candles;

  return [];
}

/**
 * Alpaca Markets Data API v2.
 * Historical bars: 4 AM ET - 8 PM ET (pre-market + regular + after-hours).
 * Docs: https://docs.alpaca.markets/reference/stockbars
 */
async function fetchAlpaca1Min(
  ticker: string,
  dateStr: string,
  apiKeyId: string,
  apiSecret: string,
): Promise<Candle[]> {
  // 4 AM ET = 9 UTC (EST), 8 PM ET = 1 AM UTC next day
  const from = `${dateStr}T09:00:00Z`;
  const [y, m, d] = dateStr.split('-').map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1, 1, 0, 0));
  const to = nextDay.toISOString().slice(0, 19) + 'Z';

  const url = 'https://data.alpaca.markets/v2/stocks/bars';
  try {
    const allBars: Candle[] = [];
    let pageToken: string | undefined;

    do {
      const params: Record<string, string | number> = {
        symbols: ticker,
        timeframe: '1Min',
        start: from,
        end: to,
        limit: 10000,
        adjustment: process.env.ALPACA_ADJUSTED === 'false' ? 'raw' : 'split',
        sort: 'asc',
      };
      if (pageToken) params.page_token = pageToken;

      const res = await axios.get(url, {
        timeout: 15000,
        params,
        headers: {
          'APCA-API-KEY-ID': apiKeyId,
          'APCA-API-SECRET-KEY': apiSecret,
        },
      });

      const barsBySymbol = res.data?.bars ?? {};
      const bars = barsBySymbol[ticker] ?? [];
      for (const b of bars) {
        const tMs = typeof b.t === 'string' ? new Date(b.t).getTime() : (b.t ?? 0);
        allBars.push({
          o: Number(b.o),
          h: Number(b.h),
          l: Number(b.l),
          c: Number(b.c),
          v: Number(b.v ?? 0),
          t: tMs,
        });
      }
      pageToken = res.data?.next_page_token;
    } while (pageToken);

    return allBars;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) throw err;
    return [];
  }
}

/**
 * Yahoo Finance v8 chart API.
 * interval=1m, includePrePost=true for pre-market and after-hours.
 * Limited to ~7 days of 1-min data.
 */
async function fetchYahoo1Min(ticker: string, dateStr: string): Promise<Candle[]> {
  const [y, m, d] = dateStr.split('-').map(Number);
  // 4 AM ET ≈ 9 UTC (pre-market start), 8 PM ET ≈ 1 AM UTC next day (after-hours end)
  const period1 = Math.floor(Date.UTC(y, m - 1, d, 9, 0, 0) / 1000);
  const period2 = Math.floor(Date.UTC(y, m - 1, d, 25, 0, 0) / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      params: {
        interval: '1m',
        period1,
        period2,
        includePrePost: true,
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StockTraining/1.0)',
        Accept: 'application/json',
      },
    });

    const result = res.data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps: number[] = result.timestamp || [];
    const quote = result.indicators?.quote?.[0];
    if (!quote) return [];

    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    const candles: Candle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      const o = opens[i];
      const h = highs[i];
      const l = lows[i];
      const v = volumes[i];
      if (c == null || o == null || h == null || l == null) continue;
      candles.push({
        o: Number(o),
        h: Number(h),
        l: Number(l),
        c: Number(c),
        v: Number(v ?? 0),
        t: timestamps[i] * 1000,
      });
    }
    return candles;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) throw err;
    return [];
  }
}

async function fetchPolygon1Min(
  ticker: string,
  dateStr: string,
  apiKey: string,
): Promise<Candle[]> {
  // 4 AM ET = 9 UTC (EST), 8 PM ET = 1 AM UTC next day. Polygon from/to are in UTC.
  const from = `${dateStr}T09:00:00Z`;
  const [y, m, d] = dateStr.split('-').map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1, 1, 0, 0));
  const toStr = nextDay.toISOString().slice(0, 19).replace('T', 'T') + 'Z';
  const adjusted = process.env.POLYGON_ADJUSTED !== 'false';
  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/1/minute/${from}/${toStr}?apiKey=${apiKey}&adjusted=${adjusted}&sort=asc`;
  try {
    const res = await axios.get(url, { timeout: 15000 });
    const results = res.data?.results;
    if (!Array.isArray(results)) return [];
    return results.map((r: any) => ({
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
      v: r.v,
      t: r.t,
    }));
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 429) throw err;
    return [];
  }
}
