import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface StockCandidate {
  ticker: string;
  price: number;
  change_pct: number;
  relative_volume: number;
  volume: number;
  avg_volume: number;
  float: number | null;
  market_cap: number | null;
  atr: number;
  pre_market_high: number | null;
  vwap: number | null;
  priority_score: number;
  reason: string;
}

export interface StockSnapshot {
  ticker: string;
  price: number;
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  volume: number;
  avg_volume: number;
  relative_volume: number;
  change_pct: number;
  pre_market_high: number | null;
  candles_1min: Candle[];
  candles_5min: Candle[];
  atr: number;
  high_of_day: number;
  low_of_day: number;
}

export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number; // timestamp ms
}

// momoscreener raw format: [open, high, low, close, volume, timestamp_ms]
type MomoCandle = [number, number, number, number, number, number];

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const envNum = (key: string, fallback: number) => parseFloat(process.env[key] ?? String(fallback));

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);
  private readonly momoBase: string;
  private readonly FILTERS: {
    price: { min: number; max: number };
    change_pct: { min: number };
    relative_volume: { min: number };
    atr: { min: number };
  };
  private readonly PRE_MARKET_HOUR_ET: number;    // hour each trading day starts (ET), default 4
  private readonly TRADING_DAYS_HISTORY: number;  // how many trading days to include, default 2
  private readonly ATR_PERIOD: number;            // candles for ATR, default 14
  private readonly TOOL_CANDLES_SHOWN: number;    // 5-min candles sent to the agent, default 30

  constructor() {
    this.momoBase = env('MOMO_BASE_URL', 'https://momoscreener.com/api/p');

    this.FILTERS = {
      price:           { min: envNum('FILTER_PRICE_MIN', 2),   max: envNum('FILTER_PRICE_MAX', 20) },
      change_pct:      { min: envNum('FILTER_CHANGE_PCT_MIN', 0.10) },
      relative_volume: { min: envNum('FILTER_REL_VOL_MIN', 5) },
      atr:             { min: envNum('FILTER_ATR_MIN', 0.50) },
    };

    this.PRE_MARKET_HOUR_ET   = envNum('PRE_MARKET_HOUR_ET', 4);
    this.TRADING_DAYS_HISTORY = envNum('TRADING_DAYS_HISTORY', 2);
    this.ATR_PERIOD           = envNum('ATR_PERIOD', 14);
    this.TOOL_CANDLES_SHOWN   = envNum('TOOL_CANDLES_SHOWN', 30);

    this.logger.log(
      `ScannerService initialized → ${this.momoBase} | ` +
      `Filters: price $${this.FILTERS.price.min}-$${this.FILTERS.price.max}, ` +
      `chg >${(this.FILTERS.change_pct.min * 100).toFixed(0)}%, ` +
      `relVol >${this.FILTERS.relative_volume.min}x, ATR >$${this.FILTERS.atr.min} | ` +
      `History: ${this.TRADING_DAYS_HISTORY} trading day(s) from ${this.PRE_MARKET_HOUR_ET}:00 AM ET`,
    );
  }

  /**
   * Fetch 1-min candles from momoscreener and build a full StockSnapshot.
   * API: GET /api/p/ticker/chart?q=TICKER&interval=1m
   * Response: { error: 0, message: { symbol, history: [[o,h,l,c,v,t], ...] } }
   * NOTE: history[0] is the MOST RECENT candle (newest first).
   */
  async getStockSnapshot(ticker: string, cutoffMs?: number): Promise<StockSnapshot> {
    ticker = ticker.toUpperCase();
    this.logger.log(
      `Fetching snapshot for ${ticker}${cutoffMs ? ` [SIMULATION cutoff: ${new Date(cutoffMs).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET]` : ''}`,
    );

    let candles1m: Candle[] = [];

    try {
      const url = `${this.momoBase}/ticker/chart?q=${ticker}&interval=1m`;
      const res = await axios.get(url, { timeout: 10000 });

      if (res.data?.error !== 0 || !res.data?.message?.history) {
        throw new Error(`momoscreener error: ${JSON.stringify(res.data)}`);
      }

      const raw: MomoCandle[] = res.data.message.history;

      // API returns newest-first → reverse to get chronological order
      candles1m = raw
        .slice()
        .reverse()
        .map(([o, h, l, c, v, t]) => ({ o, h, l, c, v, t }));
    } catch (err) {
      this.logger.warn(`momoscreener fetch failed for ${ticker}: ${err.message}`);
      return this.getMockSnapshot(ticker);
    }

    if (!candles1m.length) {
      return this.getMockSnapshot(ticker);
    }

    // ── Apply simulation cutoff (replay mode) ───────────────────────────────
    if (cutoffMs) {
      candles1m = candles1m.filter((c) => c.t <= cutoffMs);
      if (!candles1m.length) return this.getMockSnapshot(ticker);
    }

    // ── Compute stats on the FULL history before filtering ──────────────────

    // Average volume across all available days (needs full history)
    const avg_volume = this.estimateAvgDailyVolume(candles1m);

    // ATR on full 5-min history
    const all5m = this.aggregate1mTo5m(candles1m);
    const atr = this.calculateATR(all5m, this.ATR_PERIOD);

    // ── Determine history window (N trading days) ───────────────────────────
    const historyStart = this.getHistoryStartMs(candles1m, this.TRADING_DAYS_HISTORY);
    // Market open = pre-market hour + 5.5h (4 AM ET + 5.5h = 9:30 AM ET)
    const marketOpenOffset = (9.5 - this.PRE_MARKET_HOUR_ET) * 60 * 60 * 1000;
    // Most-recent day's market open (for VWAP / session stats)
    const lastDayStart = this.getHistoryStartMs(candles1m, 1);
    const marketOpen = lastDayStart + marketOpenOffset;

    // ── Filter candles to N trading days ────────────────────────────────────
    const candles1mDay = candles1m.filter((c) => c.t >= historyStart);
    const candles5mDay = this.aggregate1mTo5m(candles1mDay);

    // Current price = close of most recent candle
    const latest = candles1mDay.length
      ? candles1mDay[candles1mDay.length - 1]
      : candles1m[candles1m.length - 1];
    const price = latest.c;

    // Session candles (9:30 AM ET onwards)
    const sessionCandles = candles1mDay.filter((c) => c.t >= marketOpen);
    // Pre-market candles (4:00 AM → 9:30 AM ET)
    const preMarketCandles = candles1mDay.filter((c) => c.t < marketOpen);

    // High/Low of day (full day including pre-market)
    const allDayCandles = candles1mDay;
    const high_of_day = allDayCandles.length
      ? Math.max(...allDayCandles.map((c) => c.h))
      : price;
    const low_of_day = allDayCandles.length
      ? Math.min(...allDayCandles.map((c) => c.l))
      : price;

    // Pre-market high
    const pre_market_high = preMarketCandles.length
      ? Math.max(...preMarketCandles.map((c) => c.h))
      : null;

    // Prior day close = last candle before today's pre-market
    const priorDayCandles = candles1m.filter((c) => c.t < lastDayStart);
    const prior_close =
      priorDayCandles.length > 0
        ? priorDayCandles[priorDayCandles.length - 1].c
        : price;
    const change_pct = prior_close > 0 ? (price - prior_close) / prior_close : 0;

    // Total volume (session only)
    const volume = sessionCandles.reduce((s, c) => s + c.v, 0);
    const relative_volume = avg_volume > 0 ? volume / avg_volume : 0;

    // VWAP from today's session 5-min candles
    const session5mDay = candles5mDay.filter((c) => c.t >= marketOpen);
    const vwap = this.calculateVWAP(session5mDay);

    // EMAs from today's 5-min closes
    const closes5mDay = candles5mDay.map((c) => c.c);
    const ema9 = this.calculateEMA(closes5mDay, 9);
    const ema20 = this.calculateEMA(closes5mDay, 20);

    return {
      ticker,
      price,
      vwap,
      ema9,
      ema20,
      volume,
      avg_volume,
      relative_volume,
      change_pct,
      pre_market_high,
      candles_1min: candles1mDay,   // last trading day only
      candles_5min: candles5mDay,   // last trading day only
      atr,
      high_of_day,
      low_of_day,
    };
  }

  /**
   * Run scanner: fetch snapshots for a provided list of tickers and filter
   * by knowledge.txt criteria. If no tickers provided, uses a default watchlist
   * (you can extend this with another momoscreener screener endpoint).
   */
  async runScanner(tickers?: string[]): Promise<StockCandidate[]> {
    this.logger.log('Running scanner via momoscreener...');

    const targets = tickers?.length ? tickers : await this.getDefaultWatchlist();
    const candidates: StockCandidate[] = [];

    for (const ticker of targets) {
      try {
        const snap = await this.getStockSnapshot(ticker);
        const candidate = this.evaluateSnapshot(snap);
        if (candidate) candidates.push(candidate);
        // Small delay between requests
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        this.logger.warn(`Error evaluating ${ticker}: ${err.message}`);
      }
    }

    return candidates.sort((a, b) => b.priority_score - a.priority_score);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private evaluateSnapshot(snap: StockSnapshot): StockCandidate | null {
    const { ticker, price, change_pct, relative_volume, atr, volume } = snap;

    if (price < this.FILTERS.price.min || price > this.FILTERS.price.max) return null;
    if (change_pct < this.FILTERS.change_pct.min) return null;
    if (atr < this.FILTERS.atr.min) return null;
    if (relative_volume < this.FILTERS.relative_volume.min) return null;

    const volScore = Math.min(relative_volume / 20, 1);
    const pctScore = Math.min(change_pct / 0.5, 1);
    const atrScore = Math.min(atr / 2, 1);
    const priority_score = volScore * 0.5 + pctScore * 0.3 + atrScore * 0.2;

    return {
      ticker,
      price,
      change_pct,
      relative_volume,
      volume,
      avg_volume: snap.avg_volume,
      float: null,
      market_cap: null,
      atr,
      pre_market_high: snap.pre_market_high,
      vwap: snap.vwap,
      priority_score,
      reason: [
        `+${(change_pct * 100).toFixed(1)}% change`,
        `${relative_volume.toFixed(1)}x rel vol`,
        `ATR $${atr.toFixed(2)}`,
        `HOD $${snap.high_of_day.toFixed(2)}`,
      ].join(', '),
    };
  }

  /**
   * Default watchlist when no tickers are passed.
   * You can extend this list or wire up a momoscreener screener endpoint.
   */
  private async getDefaultWatchlist(): Promise<string[]> {
    // Try momoscreener screener endpoint for top movers
    try {
      const res = await axios.get(`${this.momoBase}/screener`, { timeout: 8000 });
      if (res.data?.tickers && Array.isArray(res.data.tickers)) {
        return res.data.tickers.slice(0, 20);
      }
    } catch {
      // endpoint may not exist — fall back to static list
    }

    // Static fallback: common small-cap high-momentum tickers to monitor
    return [
      'SOFI', 'MSTR', 'PLTR', 'AMC', 'GME', 'BBAI', 'LIFW',
      'SOUN', 'RCAT', 'BARK', 'GFAI', 'MULN', 'IDEX', 'NKLA',
    ];
  }

  private getTodayMarketOpenMs(): number {
    const now = new Date();
    const et = new Date(
      now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
    );
    const openET = new Date(et);
    openET.setHours(9, 30, 0, 0);
    const diffMs = now.getTime() - et.getTime();
    return openET.getTime() + diffMs;
  }

  /**
   * Returns the start timestamp (ms) for `days` trading days ago.
   * Counts only dates that have actual candle data — weekends/holidays are skipped
   * automatically. Returns the timestamp of the first candle on the target date
   * (avoids all timezone math by using real candle timestamps directly).
   */
  private getHistoryStartMs(candles: Candle[], days: number): number {
    if (!candles.length) return Date.now() - days * 24 * 60 * 60 * 1000;

    // Collect unique ET date strings, newest first (candles are sorted oldest→newest)
    const seen = new Set<string>();
    for (let i = candles.length - 1; i >= 0; i--) {
      const dateKey = new Date(candles[i].t).toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
      });
      if (!seen.has(dateKey)) seen.add(dateKey);
      if (seen.size >= days) break;
    }

    // The last entry in the set is the oldest of the N trading days
    const targetDateKey = [...seen].at(-1)!;

    // Return the timestamp of the very first candle on that ET date
    // (no timezone conversion math — uses actual data timestamps)
    for (let i = 0; i < candles.length; i++) {
      const dateKey = new Date(candles[i].t).toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
      });
      if (dateKey === targetDateKey) return candles[i].t;
    }

    return Date.now() - days * 24 * 60 * 60 * 1000;
  }

  private estimateAvgDailyVolume(candles: Candle[]): number {
    if (candles.length < 10) return 1;

    // Group candles by day and sum volume per day
    const dayVolumes: Record<string, number> = {};
    for (const c of candles) {
      const day = new Date(c.t).toISOString().split('T')[0];
      dayVolumes[day] = (dayVolumes[day] || 0) + c.v;
    }
    const vols = Object.values(dayVolumes);
    if (!vols.length) return 1;
    return vols.reduce((s, v) => s + v, 0) / vols.length;
  }

  /**
   * Aggregate 1-min candles into 5-min candles (chronological order).
   */
  private aggregate1mTo5m(candles1m: Candle[]): Candle[] {
    const groups: Record<number, Candle[]> = {};

    for (const c of candles1m) {
      // Round down to nearest 5-minute bucket
      const bucket = Math.floor(c.t / (5 * 60 * 1000)) * (5 * 60 * 1000);
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(c);
    }

    return Object.keys(groups)
      .map(Number)
      .sort((a, b) => a - b)
      .map((bucket) => {
        const g = groups[bucket];
        return {
          o: g[0].o,
          h: Math.max(...g.map((x) => x.h)),
          l: Math.min(...g.map((x) => x.l)),
          c: g[g.length - 1].c,
          v: g.reduce((s, x) => s + x.v, 0),
          t: bucket,
        };
      });
  }

  private calculateATR(candles: Candle[], period = 14): number {
    if (candles.length < 2) return 0;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const cur = candles[i];
      trs.push(Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c)));
    }
    const slice = trs.slice(-period);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  }

  private calculateVWAP(candles: Candle[]): number | null {
    if (!candles.length) return null;
    let totalPV = 0;
    let totalV = 0;
    for (const c of candles) {
      const typical = (c.h + c.l + c.c) / 3;
      totalPV += typical * c.v;
      totalV += c.v;
    }
    return totalV > 0 ? totalPV / totalV : null;
  }

  private calculateEMA(values: number[], period: number): number | null {
    if (values.length < period) return null;
    const k = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  // ─── Mock fallback ────────────────────────────────────────────────────────

  private getMockSnapshot(ticker: string): StockSnapshot {
    return {
      ticker,
      price: 5.42,
      vwap: 5.20,
      ema9: 5.35,
      ema20: 5.10,
      volume: 4500000,
      avg_volume: 360000,
      relative_volume: 12.5,
      change_pct: 0.35,
      pre_market_high: 5.65,
      candles_1min: [],
      candles_5min: [],
      atr: 0.82,
      high_of_day: 5.65,
      low_of_day: 4.90,
    };
  }
}
