import { Injectable, Logger } from '@nestjs/common';
import { PromisePool } from '@supercharge/promise-pool';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { buildTrainingRow, type TrainingRowOutput } from '../training/training-row-builder';
import type { TrainingCandle } from '../training/types';
import { computePremarketVolume } from '../training/premarket-volume.feature';
import { FundamentalCacheService } from '../training/fundamental-cache.service';
import { timestampToET, type SymbolMetadata } from './indicator.calculator';
import type { CollectorFeaturesTodayDto } from './dto/collector-features-today.dto';

type FeaturePreviewMetadata = SymbolMetadata & {
  openDay: number;
  openFirst: number;
  prevTradingDate: string;
};

type SymbolFeatureResult = {
  symbol: string;
  candlesCount: number;
  metadata: FeaturePreviewMetadata | null;
  rows: TrainingRowOutput[];
  candles?: TrainingCandle[];
  error?: string;
};

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

@Injectable()
export class CollectorFeaturePreviewService {
  private readonly logger = new Logger(CollectorFeaturePreviewService.name);
  private readonly fallbackEnv = this.loadFallbackEnv();

  constructor(private readonly fundamentalCache: FundamentalCacheService) {}

  private loadFallbackEnv(): Record<string, string> {
    try {
      const p = path.resolve(process.cwd(), '../stock-training/.env');
      if (!fs.existsSync(p)) return {};
      return parseDotenv(fs.readFileSync(p, 'utf8'));
    } catch {
      return {};
    }
  }

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

  private marketDataHeaders(): HeadersInit {
    const key = this.getEnvAny(['ALPACA_API_KEY_ID', 'ALPACA_KEY_ID']);
    const secret = this.getEnvAny(['ALPACA_API_SECRET_KEY', 'ALPACA_SECRET_KEY']);
    return {
      accept: 'application/json',
      'APCA-API-KEY-ID': key,
      'APCA-API-SECRET-KEY': secret,
    };
  }

  private etDateTimeToUtcIso(dateStr: string, time: string): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hh, mm, ss = '00'] = time.split(':');
    const approxUtc = new Date(`${dateStr}T${time}Z`);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      timeZoneName: 'shortOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(approxUtc);
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
    const match = tzName.match(/([A-Z]+)([+-])(\d{1,2})(?::?(\d{2}))?/i);
    const sign = match?.[2] === '-' ? -1 : 1;
    const oh = Number(match?.[3] ?? 5);
    const om = Number(match?.[4] ?? 0);
    const offsetMin = sign * (oh * 60 + om);
    const utcMs = Date.UTC(year, month - 1, day, Number(hh), Number(mm), Number(ss)) - offsetMin * 60_000;
    return new Date(utcMs).toISOString();
  }

  private async fetchBarsWithExtendedHours(
    symbol: string,
    dateStr: string,
  ): Promise<TrainingCandle[]> {
    const isTodayEt = dateStr === this.todayEt();
    const startIso = this.etDateTimeToUtcIso(dateStr, '00:00:00');
    const endIso = isTodayEt ? new Date().toISOString() : this.etDateTimeToUtcIso(dateStr, '23:59:59');

    let pageToken: string | undefined;
    const merged: TrainingCandle[] = [];

    while (true) {
      const url = new URL('https://data.alpaca.markets/v2/stocks/bars');
      url.searchParams.set('symbols', symbol);
      url.searchParams.set('timeframe', '1Min');
      url.searchParams.set('start', startIso);
      url.searchParams.set('end', endIso);
      url.searchParams.set('adjustment', 'split');
      url.searchParams.set('sort', 'asc');
      url.searchParams.set('limit', '10000');
      url.searchParams.set('feed', 'sip');
      if (pageToken) url.searchParams.set('page_token', pageToken);

      const res = await fetch(url.toString(), { method: 'GET', headers: this.marketDataHeaders() });
      if (!res.ok) {
        const body = await res.text().catch(() => '<no-body>');
        throw new Error(`alpaca bars ${res.status}: ${body}`);
      }
      const data = (await res.json()) as {
        bars?: Record<string, Array<{ o: number; h: number; l: number; c: number; v: number; t: string }>>;
        next_page_token?: string | null;
      };
      const bars = data.bars?.[symbol] ?? [];
      for (const b of bars) {
        const t = Date.parse(b.t);
        if (!Number.isFinite(t) || t <= 0) continue;
        const et = timestampToET(t);
        if (et.date !== dateStr) continue;
        merged.push({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, t });
      }
      pageToken = data.next_page_token ?? undefined;
      if (!pageToken) break;
    }

    merged.sort((a, b) => a.t - b.t);
    return merged;
  }

  private todayEt(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private prevTradingDay(dateStr: string): string {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
    else if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  private parseSymbols(input: CollectorFeaturesTodayDto): string[] {
    const fromArray = (input.symbols ?? []).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
    const fromCsv = (input.symbolsCsv ?? '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    return [...new Set([...fromArray, ...fromCsv])];
  }

  private concurrency(): number {
    return toPositiveInt(process.env.SCREENER_CHUNK_CONCURRENCY, 5);
  }

  async buildFeaturesForSymbolsByDate(
    input: CollectorFeaturesTodayDto,
  ): Promise<{ ok: boolean; date: string; results: SymbolFeatureResult[]; error?: string }> {
    const symbols = this.parseSymbols(input);
    if (!symbols.length) {
      return { ok: false, date: input.date ?? this.todayEt(), results: [], error: 'symbols required' };
    }

    const dateStr = input.date?.trim() || this.todayEt();
    const includeCandles = input.includeCandles ?? false;
    const out: SymbolFeatureResult[] = [];

    await PromisePool.withConcurrency(this.concurrency())
      .for(symbols)
      .process(async (symbol) => {
        out.push(await this.buildForOneSymbol(symbol, dateStr, includeCandles));
      });

    out.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return { ok: true, date: dateStr, results: out };
  }

  private async buildForOneSymbol(
    symbol: string,
    dateStr: string,
    includeCandles: boolean,
  ): Promise<SymbolFeatureResult> {
    try {
      const candles = await this.fetchBarsWithExtendedHours(symbol, dateStr);
      if (!candles.length) {
        return { symbol, candlesCount: 0, metadata: null, rows: [], error: 'no_data' };
      }

      const trainingCandles: TrainingCandle[] = candles.map((c) => ({ ...c }));
      const prevDate = this.prevTradingDay(dateStr);
      let priorClose = 0;
      try {
        const prevBars = await this.fetchBarsWithExtendedHours(symbol, prevDate);
        if (prevBars.length) priorClose = prevBars[prevBars.length - 1].c;
      } catch {
        priorClose = trainingCandles[0]?.o ?? trainingCandles[0]?.c ?? 0;
      }
      if (priorClose <= 0) priorClose = trainingCandles[0]?.o ?? trainingCandles[0]?.c ?? 0;

      const openDay = trainingCandles[0].o;
      const firstRegular = trainingCandles.find((c) => {
        const { minuteOfDay } = timestampToET(c.t);
        return minuteOfDay >= 9 * 60 + 30;
      });
      const openFirst = firstRegular?.o ?? openDay;
      const premarketVolume = computePremarketVolume(trainingCandles);
      const preMarketCandles = trainingCandles.filter((c) => timestampToET(c.t).minuteOfDay < 9 * 60 + 30);
      const preMarketHigh = preMarketCandles.length ? Math.max(...preMarketCandles.map((c) => c.h)) : null;

      const fundamentals = await this.fundamentalCache.getFundamentals(symbol);
      const metadata: FeaturePreviewMetadata = {
        priorClose,
        preMarketHigh: preMarketHigh ?? 0,
        sharesOutstanding: fundamentals.sharesOutstanding ?? null,
        marketCap: fundamentals.marketCap ?? null,
        gapPct: priorClose > 0 ? (openFirst - priorClose) / priorClose : 0,
        premarketVolume,
        openDay,
        openFirst,
        prevTradingDate: prevDate,
      };

      const rows: TrainingRowOutput[] = [];
      for (let i = 0; i < trainingCandles.length; i++) {
        rows.push(
          buildTrainingRow({
            symbol,
            date: dateStr,
            candles: trainingCandles,
            idx: i,
            priorClose,
            openDay,
            openFirst,
            premarketVolume,
            preMarketHigh,
            sharesOutstanding: fundamentals.sharesOutstanding,
            marketCap: fundamentals.marketCap,
          }),
        );
      }

      return {
        symbol,
        candlesCount: trainingCandles.length,
        metadata,
        rows,
        candles: includeCandles ? trainingCandles : undefined,
      };
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.warn(`features preview failed for ${symbol} ${dateStr}: ${msg}`);
      return { symbol, candlesCount: 0, metadata: null, rows: [], error: msg };
    }
  }
}

