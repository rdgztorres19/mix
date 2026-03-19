import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { ConfigService } from '@nestjs/config';
// Note: MomoDataSource fallback has been DISABLED
import { VwapCalculator, EmaCalculator, AtrCalculator } from '../../small-cap-trading';
import type { IStockDataSource, StockSnapshotOptions } from './stock-datasource.interface';
import type { Candle, StockSnapshot, VwapPoint } from '../scanner.service';

interface AlpacaBar {
  c: number; // close
  h: number; // high
  l: number; // low
  o: number; // open
  // Alpaca v2 bars use ISO8601 strings for timestamps (e.g. "2026-03-10T08:00:00Z"),
  // but some clients/libraries may still expose unix seconds as number. Support both.
  t: string | number; // timestamp (ISO string or unix seconds)
  v: number; // volume
  vw: number; // volume-weighted average price
  n: number; // number of trades
}

interface AlpacaBarsResponse {
  bars: Record<string, AlpacaBar[]>;
  symbol: string;
  next_page_token?: string;
}

/**
 * Premium Alpaca SIP feed data source (real-time).
 * Includes in-memory cache, retry logic. MoMo fallback DISABLED.
 * When no data available, returns empty snapshot - relies on 61s historical fallback.
 */
@Injectable()
export class AlpacaDataSource implements IStockDataSource {
  private readonly logger = new Logger(AlpacaDataSource.name);
  private readonly alpacaKeyId: string;
  private readonly alpacaSecretKey: string;
  private readonly alpacaBaseUrl: string = 'https://data.alpaca.markets/v2/stocks';
  private readonly maxRetries: number = 3;
  private readonly requestTimeoutMs: number = 10000;

  // In-memory cache: key = `${ticker}:${dateStr}`, value = bars
  private readonly cache = new Map<string, AlpacaBar[]>();

  constructor(
    private readonly configService: ConfigService,
    // Note: MomoDataSource dependency removed - fallback disabled
  ) {
    this.alpacaKeyId = configService.get<string>(
      'ALPACA_KEY_ID',
      'AKAS3FTVF54TKVHQSOO44I5XJH'
    );

    this.alpacaSecretKey = configService.get<string>(
      'ALPACA_SECRET_KEY',
      'Br5quiybxDxEhw2WsX1EhHMq83f4TZX4RAhoxzkdQG2d'
    );

    this.logger.log('✅ AlpacaDataSource initialized with premium SIP feed (MoMo fallback disabled)');
  }

  async getStockSnapshot(
    ticker: string,
    options?: StockSnapshotOptions,
  ): Promise<StockSnapshot> {
    ticker = ticker.toUpperCase();

    try {
      const timeframe = options?.timeframe ?? '5m';
      const cutoffMs = options?.cutoffMs;
      const dateStr = options?.date ?? this.getTodayET();

      this.logger.log(
        `🎯 Fetching Alpaca snapshot for ${ticker} | ${timeframe}` +
        (cutoffMs ? ` [SIMULATION cutoff: ${new Date(cutoffMs).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET]` : ''),
      );

      // Try Alpaca with retries
      let bars = await this.fetchBarWithRetries(ticker, dateStr);

      if (!bars || bars.length === 0) {
        this.logger.warn(`⚠️ No data available from Alpaca for ${ticker} - returning empty snapshot`);
        this.logger.debug(`MoMo fallback is DISABLED - relying on 61s historical fallback only`);
        return this.emptySnapshot(ticker);
      }

      // Convert Alpaca bars to candles (ISO string or unix seconds -> ms)
      this.logger.debug(`🔍 Raw Alpaca bars sample for ${ticker}: ${JSON.stringify(bars.slice(0, 2))}`);

      const candles1m = bars.map((bar) => {
        const timestampMs = this.parseAlpacaTimestamp(bar.t);
        if (timestampMs === null) {
          this.logger.warn(`⚠️ Invalid/missing timestamp in bar for ${ticker}: ${JSON.stringify(bar)}`);
        }
        return {
          o: bar.o,
          h: bar.h,
          l: bar.l,
          c: bar.c,
          v: bar.v,
          t: timestampMs,
        };
      });

      this.logger.debug(`🔍 Converted candles sample for ${ticker}: ${JSON.stringify(candles1m.slice(0, 2))}`);

      const validCandles = candles1m.filter(
        (c) => typeof c.t === 'number' && Number.isFinite(c.t as number),
      );
      this.logger.log(
        `📊 ${ticker}: ${candles1m.length} candles total, ${validCandles.length} with valid numeric timestamps`,
      );

      if (validCandles.length === 0) {
        this.logger.warn(`⚠️ No valid candles after timestamp filtering for ${ticker}`);
        return this.emptySnapshot(ticker);
      }

      // Apply simulation cutoff if provided
      let filtered = validCandles;
      if (cutoffMs) {
        filtered = validCandles.filter((c) => c.t && c.t <= cutoffMs);
        if (filtered.length === 0) {
          return this.emptySnapshot(ticker);
        }
      }

      // Aggregate to 5-minute candles
      const candles5m = this.aggregate1mTo5m(filtered);

      // Choose which candles to use for metrics based on timeframe
      const candlesForMetrics = timeframe === '1m' ? filtered : candles5m;
      const latest = candlesForMetrics[candlesForMetrics.length - 1]!;
      const price = latest.c;

      // Basic metrics
      const high_of_day = Math.max(...filtered.map((c) => c.h));
      const low_of_day = Math.min(...filtered.map((c) => c.l));
      const volume = filtered.reduce((sum, c) => sum + c.v, 0);

      // Estimate average volume from first bar of day (rough estimate)
      const avg_volume = this.estimateAvgVolume(bars);
      const relative_volume = avg_volume > 0 ? volume / avg_volume : 0;

      // Calculate technical indicators
      const vwap = VwapCalculator.calculate(candlesForMetrics);
      const vwap_line = VwapCalculator.calculateLine(candlesForMetrics);

      const closes = candlesForMetrics.map((c) => c.c);
      const ema9 = EmaCalculator.calculate(closes, 9);
      const ema20 = EmaCalculator.calculate(closes, 20);
      const atr = AtrCalculator.calculate(candlesForMetrics, 14);

      // Determine change_pct (since market open)
      const marketOpenPrice = validCandles.length > 0 ? validCandles[0]!.o : price;
      const change_pct = marketOpenPrice > 0 ? (price - marketOpenPrice) / marketOpenPrice : 0;

      // Pre-market high (estimate from available data)
      const pre_market_high = null; // Alpaca API would need separate pre-market endpoint

      this.logger.log(`✅ Alpaca: ${ticker} fetched ${bars.length} bars successfully`);

      return {
        ticker,
        price,
        vwap: vwap > 0 ? vwap : null,
        vwap_line,
        ema9: ema9 != null && ema9 > 0 ? ema9 : null,
        ema20: ema20 != null && ema20 > 0 ? ema20 : null,
        volume,
        avg_volume,
        relative_volume,
        change_pct,
        pre_market_high,
        candles_1min: filtered,
        candles_5min: candles5m,
        atr,
        high_of_day,
        low_of_day,
      };
    } catch (err) {
      this.logger.error(`❌ Alpaca datasource failed: ${err instanceof Error ? err.message : String(err)}`);
      this.logger.debug(`Error: ${err}`);

      // No fallback to Momo (disabled) - return empty snapshot
      this.logger.warn(`⚠️ ${ticker} data unavailable from Alpaca - returning empty snapshot (MoMo disabled)`);
      return this.emptySnapshot(ticker);
    }
  }

  private async fetchBarWithRetries(
    ticker: string,
    dateStr: string,
    attempt: number = 1,
  ): Promise<AlpacaBar[]> {
    const cacheKey = `${ticker}:${dateStr}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      this.logger.debug(`💵 Cache hit for ${ticker} on ${dateStr}`);
      return this.cache.get(cacheKey)!;
    }

    try {
      const bars = await this.fetchBarsFromAlpaca(ticker, dateStr);

      // Store in cache
      this.cache.set(cacheKey, bars);
      this.logger.debug(`💾 Cached ${bars.length} bars for ${ticker}:${dateStr}`);

      return bars;
    } catch (err) {
      const errMsg = err instanceof AxiosError ? err.message : String(err);
      this.logger.warn(
        `🔄 Alpaca fetch attempt ${attempt}/${this.maxRetries} failed for ${ticker}: ${errMsg}`,
      );

      if (attempt < this.maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        this.logger.debug(`⏳ Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.fetchBarWithRetries(ticker, dateStr, attempt + 1);
      }

      // All retries exhausted
      throw err;
    }
  }

  private async fetchBarsFromAlpaca(ticker: string, dateStr: string): Promise<AlpacaBar[]> {
    const url = `${this.alpacaBaseUrl}/${ticker}/bars`;

    const params: Record<string, string> = {
      feed: 'sip', // Premium SIP feed
      timeframe: '1Min', // Always fetch 1-minute bars
      start: `${dateStr}T00:00:00Z`, // Full day
      end: `${dateStr}T23:59:59Z`,   // Full day
      limit: '10000', // Maximum allowed
    };

    const headers = {
      'APCA-API-KEY-ID': this.alpacaKeyId,
      'APCA-API-SECRET-KEY': this.alpacaSecretKey,
    };

    this.logger.debug(`📡 Fetching from Alpaca: ${url} with feed=sip`);

    const response = await axios.get<AlpacaBarsResponse>(url, {
      params,
      headers,
      timeout: this.requestTimeoutMs,
    });

    // Add detailed logging to debug the response
    this.logger.debug(`📈 Alpaca response status: ${response.status} for ${ticker}`);
    this.logger.debug(`📈 Response data keys: ${JSON.stringify(Object.keys(response.data || {}))}`);

    if (response.data?.bars) {
      this.logger.debug(`📈 Response bars type: ${Array.isArray(response.data.bars) ? 'Array' : 'Object'}, length: ${response.data.bars.length || Object.keys(response.data.bars).length}`);
      if (Array.isArray(response.data.bars)) {
        this.logger.debug(`📈 Found ${response.data.bars.length} bars for ${ticker} (Array format)`);
      } else {
        this.logger.debug(`📈 Response bars keys: ${JSON.stringify(Object.keys(response.data.bars))}`);
        if (response.data.bars[ticker]) {
          this.logger.debug(`📈 Found bars for ${ticker}: ${response.data.bars[ticker].length} bars`);
        } else {
          this.logger.warn(`⚠️ No bars found for ${ticker} in response. Available symbols: ${JSON.stringify(Object.keys(response.data.bars))}`);
        }
      }
    } else {
      this.logger.warn(`⚠️ No 'bars' property in Alpaca response for ${ticker}. Response: ${JSON.stringify(response.data)}`);
    }

    // Handle both array and object format for bars
    let bars;
    if (!response.data || !response.data.bars) {
      // Treat as "no data" (do not crash collector on missing bars).
      this.logger.warn(`⚠️ No bar data in Alpaca response for ${ticker} (${dateStr})`);
      return [];
    }

    if (Array.isArray(response.data.bars)) {
      // Bars is an array (single symbol response)
      bars = response.data.bars;
    } else {
      // Bars is an object keyed by ticker (multi-symbol response)
      bars = response.data.bars[ticker];
    }

    if (!bars || (Array.isArray(bars) && bars.length === 0)) {
      // Some symbols/dates legitimately have no bars (halts, delisted, etc).
      this.logger.warn(`⚠️ No bars returned by Alpaca for ${ticker} (${dateStr})`);
      return [];
    }
    if (!Array.isArray(bars)) {
      throw new Error(`Expected array of bars from Alpaca, got ${typeof bars}`);
    }

    // Ensure bars are sorted chronologically using parsed timestamps
    return bars.sort((a, b) => {
      const ta = this.parseAlpacaTimestamp(a.t);
      const tb = this.parseAlpacaTimestamp(b.t);
      if (ta === null || tb === null) return 0;
      return ta - tb;
    });
  }

  private aggregate1mTo5m(candles: Candle[]): Candle[] {
    if (candles.length === 0) return [];

    const groups: Record<number, Candle[]> = {};

    for (const candle of candles) {
      // Group by 5-minute bucket
      const bucket = Math.floor(candle.t / (5 * 60 * 1000)) * (5 * 60 * 1000);
      if (!groups[bucket]) {
        groups[bucket] = [];
      }
      groups[bucket].push(candle);
    }

    // Build aggregated candles
    return Object.keys(groups)
      .map(Number)
      .sort((a, b) => a - b)
      .map((bucket) => {
        const group = groups[bucket]!;
        const opens = group.map((c) => c.o);
        const closes = group.map((c) => c.c);
        const highs = group.map((c) => c.h);
        const lows = group.map((c) => c.l);

        return {
          o: opens[0]!, // First open
          h: Math.max(...highs), // Max high
          l: Math.min(...lows), // Min low
          c: closes[closes.length - 1]!, // Last close
          v: group.reduce((sum, c) => sum + c.v, 0), // Sum volume
          t: bucket, // Timestamp of bucket
        };
      });
  }

  private estimateAvgVolume(bars: AlpacaBar[]): number {
    if (bars.length === 0) return 1;

    // Use total daily volume as rough estimate 
    const totalVolume = bars.reduce((sum, bar) => sum + bar.v, 0);
    return Math.max(totalVolume, 1);
  }

  /**
   * Normalize Alpaca bar timestamps to milliseconds since epoch.
   * Supports both ISO8601 strings (v2 API) and unix seconds as number.
   */
  private parseAlpacaTimestamp(raw: string | number): number | null {
    if (typeof raw === 'number') {
      if (!Number.isFinite(raw)) return null;
      // Alpaca numeric timestamps are unix seconds
      return raw * 1000;
    }

    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      if (Number.isNaN(parsed)) return null;
      return parsed;
    }

    return null;
  }

  private getTodayET(): string {
    return new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/New_York',
    }); // Returns YYYY-MM-DD
  }

  private emptySnapshot(ticker: string): StockSnapshot {
    return {
      ticker: ticker.toUpperCase(),
      price: 0,
      vwap: null,
      vwap_line: [] as VwapPoint[],
      ema9: null,
      ema20: null,
      volume: 0,
      avg_volume: 1,
      relative_volume: 0,
      change_pct: 0,
      pre_market_high: null,
      candles_1min: [],
      candles_5min: [],
      atr: 0.5,
      high_of_day: 0,
      low_of_day: 0,
    };
  }

  /**
   * Direct API call for WebSocket fallback (bypasses cache and retry logic).
   * Used by WebSocket fallback cron to fetch specific missing bars.
   */
  async fetchBarsFromAlpacaDirect(params: {
    symbol: string;
    timeframe: string;
    start: string;
    end: string;
    feed: string;
    limit: number;
  }): Promise<AlpacaBarsResponse | null> {
    const url = `${this.alpacaBaseUrl}/${params.symbol}/bars`;

    const headers = {
      'APCA-API-KEY-ID': this.alpacaKeyId,
      'APCA-API-SECRET-KEY': this.alpacaSecretKey,
    };

    try {
      const response = await axios.get<AlpacaBarsResponse>(url, {
        params: {
          feed: params.feed,
          timeframe: params.timeframe,
          start: params.start,
          end: params.end,
          limit: params.limit.toString(),
        },
        headers,
        timeout: this.requestTimeoutMs,
      });

      // this.logger.debug(`✅ Direct API call successful for ${params.symbol}: ${response.status}`);
      return response.data;

    } catch (error) {
      const errMsg = error instanceof AxiosError ? error.message : String(error);
      this.logger.error(`❌ Direct API call failed for ${params.symbol}: ${errMsg}`);
      return null;
    }
  }

  /**
   * Clear cache (useful for testing or manual reset).
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('🗑️ Alpaca cache cleared');
  }

  /**
   * Fetch 1m bars for a symbol on a specific date.
   * Returns candles in {o,h,l,c,v,t} format with t in ms.
   * Used by sync-symbol-date endpoint.
   */
  async fetch1mBarsForDate(
    symbol: string,
    dateStr: string,
  ): Promise<Array<{ o: number; h: number; l: number; c: number; v: number; t: number }>> {
    const bars = await this.fetchBarWithRetries(symbol, dateStr);
    return bars
      .map((bar) => {
        const t = this.parseAlpacaTimestamp(bar.t);
        if (t === null) return null;
        return { o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v, t };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null && c.t > 0);
  }
}