import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseDotenv } from 'dotenv';

export type AlpacaAssetDto = {
  id: string;
  class: string;
  exchange: string;
  symbol: string;
  name: string;
  status: string;
  tradable: boolean;
  marginable: boolean;
  maintenance_margin_requirement: number | string;
  margin_requirement_long: number | string;
  margin_requirement_short: number | string;
  shortable: boolean;
  easy_to_borrow: boolean;
  fractionable: boolean;
};

export type AlpacaBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number;
  vw?: number;
};

type BarsResponse = {
  bars: Record<string, AlpacaBar[]>;
  next_page_token?: string | null;
};

export type SnapshotBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number;
  vw?: number;
};

export type SnapshotItem = {
  dailyBar?: SnapshotBar;
  prevDailyBar?: SnapshotBar;
  latestTrade?: { p: number; t?: string; s?: number };
};

export type SnapshotsResponse = Record<string, SnapshotItem>;

const ASSETS_URL = 'https://paper-api.alpaca.markets/v2/assets';
const BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars';
const SNAPSHOTS_URL = 'https://data.alpaca.markets/v2/stocks/snapshots';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

@Injectable()
export class AlpacaScreenerClient {
  private readonly logger = new Logger(AlpacaScreenerClient.name);
  private readonly maxRetries = toPositiveInt(process.env.SCREENER_MAX_RETRIES, 20);
  private readonly fallbackEnv = this.loadFallbackEnv();

  private loadFallbackEnv(): Record<string, string> {
    try {
      const p = path.resolve(process.cwd(), '../stock-training/.env');
      if (!fs.existsSync(p)) return {};
      const raw = fs.readFileSync(p, 'utf8');
      return parseDotenv(raw);
    } catch {
      return {};
    }
  }

  /** First match wins: process.env over each name, then fallback file over each name. */
  private getEnvAny(names: string[]): string {
    for (const n of names) {
      const v = process.env[n]?.trim();
      if (v) return v;
    }
    for (const n of names) {
      const v = this.fallbackEnv[n]?.trim();
      if (v) return v;
    }
    return '';
  }

  private tradingHeaders(): HeadersInit {
    const key = this.getEnvAny(['ALPACA_PAPER_API_KEY_ID', 'ALPACA_PAPER_KEY_ID']);
    const secret = this.getEnvAny(['ALPACA_PAPER_API_SECRET_KEY', 'ALPACA_PAPER_SECRET_KEY']);
    if (!key || !secret) {
      throw new Error(
        'Missing paper trading keys for paper-api assets: set ALPACA_PAPER_API_KEY_ID + ALPACA_PAPER_API_SECRET_KEY (or ALPACA_PAPER_KEY_ID + ALPACA_PAPER_SECRET_KEY)',
      );
    }
    return {
      accept: 'application/json',
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
    };
  }

  private marketDataHeaders(): HeadersInit {
    const key = this.getEnvAny(['ALPACA_API_KEY_ID', 'ALPACA_KEY_ID']);
    const secret = this.getEnvAny(['ALPACA_API_SECRET_KEY', 'ALPACA_SECRET_KEY']);
    return {
      accept: 'application/json',
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
    };
  }

  private async safeReadText(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return '<no-body>';
    }
  }

  private async fetchWithRetry(url: string, headers: HeadersInit, context: string): Promise<Response> {
    let attempt = 0;
    while (true) {
      attempt += 1;
      const res = await fetch(url, { method: 'GET', headers });

      if (res.status === 429) {
        if (attempt > this.maxRetries) {
          throw new Error(`[${context}] too many 429 retries`);
        }
        this.logger.warn(`[429] ${context} -> waiting 60s (${attempt}/${this.maxRetries})`);
        await sleep(60_000);
        continue;
      }

      if (res.status >= 500 && res.status <= 599) {
        if (attempt > this.maxRetries) {
          const body = await this.safeReadText(res);
          throw new Error(`[${context}] ${res.status}: ${body}`);
        }
        const backoff = Math.min(attempt * 5_000, 60_000);
        this.logger.warn(`[${res.status}] ${context} -> waiting ${backoff}ms`);
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        const body = await this.safeReadText(res);
        throw new Error(`[${context}] ${res.status}: ${body}`);
      }

      return res;
    }
  }

  async fetchAllActiveUsEquityAssets(): Promise<AlpacaAssetDto[]> {
    const url = new URL(ASSETS_URL);
    url.searchParams.set('status', 'active');
    url.searchParams.set('asset_class', 'us_equity');
    const res = await this.fetchWithRetry(url.toString(), this.tradingHeaders(), 'screener assets');
    return (await res.json()) as AlpacaAssetDto[];
  }

  async fetchSnapshotsForChunk(symbols: string[]): Promise<SnapshotsResponse> {
    if (!symbols.length) return {};
    const url = new URL(SNAPSHOTS_URL);
    url.searchParams.set('symbols', symbols.join(','));
    const res = await this.fetchWithRetry(
      url.toString(),
      this.marketDataHeaders(),
      `snapshots chunk size=${symbols.length}`,
    );
    return (await res.json()) as SnapshotsResponse;
  }

  /** One symbol set per request; merges pages. */
  async fetchDailyBarsForChunk(
    symbols: string[],
    startDate: string,
    endDate: string,
  ): Promise<Record<string, AlpacaBar[]>> {
    const merged: Record<string, AlpacaBar[]> = {};
    let pageToken: string | undefined;

    while (true) {
      const url = new URL(BARS_URL);
      url.searchParams.set('symbols', symbols.join(','));
      url.searchParams.set('timeframe', '1Day');
      url.searchParams.set('start', `${startDate}T00:00:00Z`);
      url.searchParams.set('end', `${endDate}T23:59:59Z`);
      url.searchParams.set('adjustment', 'split');
      url.searchParams.set('sort', 'asc');
      url.searchParams.set('limit', '10000');
      if (pageToken) url.searchParams.set('page_token', pageToken);

      const res = await this.fetchWithRetry(
        url.toString(),
        this.marketDataHeaders(),
        `bars chunk size=${symbols.length}`,
      );
      const data = (await res.json()) as BarsResponse;

      for (const [symbol, bars] of Object.entries(data.bars || {})) {
        if (!merged[symbol]) merged[symbol] = [];
        merged[symbol] = merged[symbol].concat(bars);
      }

      pageToken = data.next_page_token || undefined;
      if (!pageToken) break;
    }

    return merged;
  }
}
