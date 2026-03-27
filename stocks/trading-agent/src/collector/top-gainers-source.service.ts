import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ScreenerService } from '../scanner/screener/screener.service';

export type TopGainerSource = 'internal' | 'hpg' | 'alpaca_screener';

export enum TopGainerSourceEnum {
  INTERNAL = 'INTERNAL',
  HPG = 'HPG',
  ALPACA = 'ALPACA',
}

/**
 * Read TOP_GAINERS_SOURCE from env (default: internal).
 * Accepts: internal (app screener GET /screener/combined), hpg, alpaca / alpaca_screener.
 */
export function getTopGainerSourceFromEnv(): TopGainerSource {
  const raw = (process.env.TOP_GAINERS_SOURCE ?? 'internal').toLowerCase();
  if (raw === 'hpg') return 'hpg';
  if (raw === 'alpaca' || raw === 'alpaca_screener') return 'alpaca_screener';
  return 'internal';
}

const HPG_URL = 'https://hpg-api.hpg-charts.workers.dev/get-top-gainers-all';
const ALPACA_SCREENER_URL = 'https://data.alpaca.markets/v1beta1/screener/stocks/movers';

@Injectable()
export class TopGainersSourceService {
  private readonly logger = new Logger(TopGainersSourceService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly screenerService: ScreenerService,
  ) {}

  /**
   * Symbols from the in-process screener (same data as GET /screener/combined).
   */
  async fetchFromInternalScreener(): Promise<string[]> {
    try {
      const symbols = await this.screenerService.getCombinedSymbols();
      if (!Array.isArray(symbols)) {
        this.logger.warn('Internal screener: invalid response (expected string[])');
        return [];
      }
      const out = symbols
        .map((s) => String(s ?? '').toUpperCase().trim())
        .filter((s) => s.length > 0);
      this.logger.log(`Internal screener (combined): ${out.length} symbols`);
      return out;
    } catch (err) {
      this.logger.warn(`Internal screener failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Fetch top gainer symbols from HPG API (get-top-gainers-all).
   */
  async fetchFromHpg(): Promise<string[]> {
    try {
      const res = await axios.get(HPG_URL, { timeout: 10000 });
      const gainers = res.data?.gainers;
      if (!Array.isArray(gainers)) {
        this.logger.warn('HPG API: invalid response (no gainers array)');
        return [];
      }
      const symbols = gainers
        .map((g: { symbol?: string }) => g?.symbol?.toUpperCase())
        .filter((s: string) => s && s.length > 0);
      this.logger.log(`HPG: fetched ${symbols.length} top gainers`);
      return symbols;
    } catch (err) {
      this.logger.warn(`HPG fetch failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Fetch top gainer symbols from Alpaca screener.
   * Requires ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY (or ALPACA_KEY_ID / ALPACA_SECRET_KEY).
   */
  async fetchFromAlpacaScreener(): Promise<string[]> {
    const keyId = process.env.ALPACA_PAPER_KEY_ID;
    const secretKey = process.env.ALPACA_PAPER_SECRET_KEY;

    if (!keyId || !secretKey) {
      this.logger.warn('Alpaca screener: missing API keys (ALPACA_API_KEY_ID, ALPACA_API_SECRET_KEY)');
      return [];
    }

    try {
      const res = await axios.get(ALPACA_SCREENER_URL, {
        timeout: 10000,
        headers: {
          'APCA-API-KEY-ID': keyId,
          'APCA-API-SECRET-KEY': secretKey,
        },
      });
      const gainers = res.data?.gainers;
      if (!Array.isArray(gainers)) {
        this.logger.warn('Alpaca screener: invalid response (no gainers array)');
        return [];
      }
      const symbols = gainers
        .map((g: { symbol?: string }) => g?.symbol?.toUpperCase())
        .filter((s: string) => s && s.length > 0);
      this.logger.log(`Alpaca screener: fetched ${symbols.length} top gainers`);
      return symbols;
    } catch (err) {
      this.logger.warn(`Alpaca screener fetch failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Fetch symbols from the given source.
   */
  async fetchSymbols(source: TopGainerSource): Promise<string[]> {
    if (source === 'internal') return this.fetchFromInternalScreener();
    if (source === 'hpg') return this.fetchFromHpg();
    return this.fetchFromAlpacaScreener();
  }
}
