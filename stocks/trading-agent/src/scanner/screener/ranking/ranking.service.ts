import { Injectable, Logger } from '@nestjs/common';
import { PromisePool } from '@supercharge/promise-pool';
import { AlpacaScreenerClient, type SnapshotsResponse } from '../alpaca/alpaca-screener.client';
import {
  ScreenerRepository,
  type ScreenerRankRow,
  type ScreenerRankType,
} from '../persistence/screener.repository';
import { AssetsService } from '../assets/assets.service';
import { ActiveSymbolsService } from '../active/active-symbols.service';
import { getEtYYYYMMDD } from '../utils/et-time';
import {
  rankTopGappers,
  rankTopGainersIntraday,
  rankTopGainersSession,
  rankTopHighCurrent,
  rankTopHighSession,
  barsPrevCloseBeforeSession,
} from './rankers/screener-rankers';

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function minusCalendarDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);

  // Cache in-memory por `sessionDate` para evitar leer prev_close desde MySQL
  // en cada tick (cron cada 1 minuto).
  private prevCloseCacheSessionDate: string | null = null;
  private prevCloseCache: Map<string, number> | null = null;
  private prevCloseCachePromise: Promise<Map<string, number>> | null = null;

  private fullSyncInFlight: Promise<{ status: string; symbols: number; ranks: boolean }> | null = null;

  constructor(
    private readonly alpaca: AlpacaScreenerClient,
    private readonly assets: AssetsService,
    private readonly repo: ScreenerRepository,
    private readonly activeSymbols: ActiveSymbolsService,
  ) {}

  private chunkSize(): number {
    return toPositiveInt(process.env.SCREENER_CHUNK_SIZE, 1000);
  }

  private concurrency(): number {
    return toPositiveInt(process.env.SCREENER_CHUNK_CONCURRENCY, 5);
  }

  private topN(): number {
    return toPositiveInt(process.env.SCREENER_TOP_N, 40);
  }

  private volumenRequired(): number {
    return toPositiveInt(process.env.SCREENER_VOLUMEN_REQUIRED, 500000);
  }

  async getTopGappers(): Promise<ScreenerRankRow[]> {
    return this.repo.getRankRows('gapper');
  }

  async getTopGainersSession(): Promise<ScreenerRankRow[]> {
    return this.repo.getRankRows('gainer_session');
  }

  async getTopGainersIntraday(): Promise<ScreenerRankRow[]> {
    return this.repo.getRankRows('gainer_intraday');
  }

  /** Back-compat: session gainers as primary list */
  async getTopGainers(): Promise<ScreenerRankRow[]> {
    return this.getTopGainersSession();
  }

  async getTopHighs(): Promise<{ session: ScreenerRankRow[]; current: ScreenerRankRow[] }> {
    const [session, current] = await Promise.all([
      this.repo.getRankRows('high_session'),
      this.repo.getRankRows('high_current'),
    ]);
    return { session, current };
  }

  async getCombinedSymbols(): Promise<string[]> {
    const rows = await this.activeSymbols.getActive(getEtYYYYMMDD());
    return rows.map((r) => r.symbol);
  }

  async getActiveRows(): Promise<{ rank_order: number; symbol: string; score: number }[]> {
    return this.activeSymbols.getActive(getEtYYYYMMDD());
  }

  async getStatus(): Promise<{
    last_run_utc: string | null;
    last_session_date: string | null;
    symbols_scanned: number | null;
    note: string | null;
  }> {
    const m = await this.repo.getRunMeta();
    return {
      last_run_utc: m?.last_run_utc?.toISOString() ?? null,
      last_session_date: m?.last_session_date ?? null,
      symbols_scanned: m?.symbols_scanned ?? null,
      note: m?.note ?? null,
    };
  }

  /**
   * Full pipeline: prev-close backfill, snapshots (PromisePool), ranks, quote cache, active set.
   */
  async syncAllRankings(): Promise<{ status: string; symbols: number; ranks: boolean }> {
    if (this.fullSyncInFlight) return this.fullSyncInFlight;
    this.fullSyncInFlight = this.runPipeline({ full: true });
    try {
      return await this.fullSyncInFlight;
    } finally {
      this.fullSyncInFlight = null;
    }
  }

  /** Post-market: refresh quote snapshots only (no rank recompute). */
  async refreshQuoteCacheOnly(): Promise<{ status: string; symbols: number }> {
    const r = await this.runPipeline({ full: false });
    return { status: r.status, symbols: r.symbols };
  }

  private async mergeSnapshots(universe: string[]): Promise<SnapshotsResponse> {
    const chunks = chunkArray(universe, this.chunkSize());
    const merged: SnapshotsResponse = {};
    const conc = this.concurrency();

    await PromisePool.withConcurrency(conc)
      .for(chunks)
      .process(async (chunk) => {
        const part = await this.alpaca.fetchSnapshotsForChunk(chunk);
        Object.assign(merged, part);
      });

    return merged;
  }

  private async ensurePrevCloseCache(
    universe: string[],
    sessionDate: string,
  ): Promise<Map<string, number>> {
    if (this.prevCloseCacheSessionDate === sessionDate && this.prevCloseCache) {
      this.logger.debug(`prev_close cache hit for ${sessionDate}`);
      return this.prevCloseCache;
    }
    if (this.prevCloseCacheSessionDate === sessionDate && this.prevCloseCachePromise) {
      this.logger.debug(`prev_close cache in-flight wait for ${sessionDate}`);
      return this.prevCloseCachePromise;
    }

    this.prevCloseCacheSessionDate = sessionDate;
    const t0 = Date.now();
    this.prevCloseCachePromise = (async () => {
      this.logger.log(`prev_close cache build start for ${sessionDate}`);
      let map = await this.repo.getPrevCloseMapForDate(sessionDate);
      const missing = universe.filter((s) => !map.has(s.toUpperCase()));
      this.logger.log(
        `prev_close cache for ${sessionDate}: have=${map.size} missing=${missing.length} universe=${universe.length}`,
      );
      if (!missing.length) return map;

      const paddedStart = minusCalendarDays(sessionDate, 10);
      const chunks = chunkArray(missing, this.chunkSize());
      const conc = this.concurrency();
      this.logger.warn(
        `prev_close cache backfill needed (${missing.length} symbols) -> chunks=${chunks.length} conc=${conc}`,
      );

      const upserts: { symbol: string; prevClose: number }[] = [];

      await PromisePool.withConcurrency(conc)
        .for(chunks)
        .process(async (chunk) => {
          const barsBySymbol = await this.alpaca.fetchDailyBarsForChunk(
            chunk,
            paddedStart,
            sessionDate,
          );
          for (const sym of chunk) {
            const bars = barsBySymbol[sym] ?? barsBySymbol[sym.toUpperCase()] ?? [];
            const pc = barsPrevCloseBeforeSession(bars, sessionDate);
            // Negative caching:
            // If Alpaca doesn't return bars for the symbol (or doesn't contain a valid prev close yet),
            // store a sentinel to avoid re-calling Alpaca on every 1-minute tick.
            //
            // Rankers treat prevClose <= 0 as invalid, so this won't create rankings from bad data.
            upserts.push({
              symbol: sym.toUpperCase(),
              prevClose: pc ?? -1,
            });
          }
        });

      if (upserts.length) {
        this.logger.log(`prev_close upsert batch: ${upserts.length} rows for ${sessionDate}`);
        await this.repo.upsertPrevClosesBatch(sessionDate, 'alpaca_bar', upserts);
        for (const e of upserts) map.set(e.symbol.toUpperCase(), e.prevClose);
      }

      this.logger.log(
        `prev_close cache build done for ${sessionDate} (${Date.now() - t0}ms)`,
      );
      return map;
    })();

    try {
      const m = await this.prevCloseCachePromise;
      this.prevCloseCache = m;
      return m;
    } finally {
      this.prevCloseCachePromise = null;
    }
  }

  private async persistQuotesBatch(snapshots: SnapshotsResponse): Promise<void> {
    const entries: {
      symbol: string;
      lastPrice: number | null;
      dayHigh: number | null;
      dayLow: number | null;
      dayClose: number | null;
      volume: number | null;
    }[] = [];

    for (const [symbol, item] of Object.entries(snapshots)) {
      const d = item?.dailyBar;
      if (!d) continue;
      const last = item.latestTrade?.p ?? d.c;

      entries.push({
        symbol,
        lastPrice: Number.isFinite(last) ? last : null,
        dayHigh: Number.isFinite(d.h) ? d.h : null,
        dayLow: Number.isFinite(d.l) ? d.l : null,
        dayClose: Number.isFinite(d.c) ? d.c : null,
        volume: d.v != null ? Number(d.v) : null,
      });
    }

    await this.repo.upsertQuoteSnapshotsBatch(entries);
  }

  private async runPipeline(opts: { full: boolean }): Promise<{
    status: string;
    symbols: number;
    ranks: boolean;
  }> {
    const sessionDate = getEtYYYYMMDD();
    const universe = await this.assets.getAllSymbols();
    if (!universe.length) {
      this.logger.warn('screener universe empty; skip sync');
      await this.repo.updateRunMeta(sessionDate, 0, 'empty_universe');
      return { status: 'ok', symbols: 0, ranks: false };
    }

    const prevMap = opts.full ? await this.ensurePrevCloseCache(universe, sessionDate) : new Map<string, number>();

    const snapshots = await this.mergeSnapshots(universe);

    if (opts.full) {
      const n = this.topN();
      const minVol = this.volumenRequired();
      const lists: { type: ScreenerRankType; rows: ScreenerRankRow[] }[] = [
        { type: 'gapper', rows: rankTopGappers(snapshots, sessionDate, prevMap, n, minVol) },
        { type: 'gainer_session', rows: rankTopGainersSession(snapshots, sessionDate, prevMap, n, minVol) },
        { type: 'gainer_intraday', rows: rankTopGainersIntraday(snapshots, sessionDate, prevMap, n, minVol) },
        { type: 'high_session', rows: rankTopHighSession(snapshots, sessionDate, prevMap, n, minVol) },
        { type: 'high_current', rows: rankTopHighCurrent(snapshots, sessionDate, prevMap, n, minVol) },
      ];

      for (const { type, rows } of lists) {
        await this.repo.replaceRankRows(type, rows);
      }

      await this.activeSymbols.rebuildFromStoredRanks(sessionDate);
    }

    await this.persistQuotesBatch(snapshots);

    await this.repo.updateRunMeta(
      sessionDate,
      universe.length,
      opts.full ? 'full_rank+quotes' : 'quotes_only',
    );

    return { status: 'ok', symbols: universe.length, ranks: opts.full };
  }
}
