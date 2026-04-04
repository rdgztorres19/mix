import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Candle1mEntity } from '../database/entities/candle-1m.entity';
import { StockNewsEntity } from '../database/entities/stock-news.entity';
import { StockProfileEntity } from '../database/entities/stock-profile.entity';
import { SyncMetaEntity } from '../database/entities/sync-meta.entity';
import { GzReaderService } from './gz-reader.service';
import { ProfileReaderService } from './profile-reader.service';
import { computeScreener, type DailySnapshot, timestampToET } from '@small-caps/core';
import type { Candle } from '@small-caps/shared';
import { MARKET_OPEN_MINUTE, ATR_PERIOD, EMA9_PERIOD, EMA20_PERIOD } from '@small-caps/shared';

const BATCH_SIZE = 5000;

@Injectable()
export class SyncWorkerService {
  private profileCache = new Map<string, { sharesOutstanding: number | null; marketCap: number | null }>();

  constructor(
    @InjectRepository(Candle1mEntity)
    private readonly candleRepo: Repository<Candle1mEntity>,
    @InjectRepository(StockNewsEntity)
    private readonly newsRepo: Repository<StockNewsEntity>,
    @InjectRepository(StockProfileEntity)
    private readonly profileRepo: Repository<StockProfileEntity>,
    @InjectRepository(SyncMetaEntity)
    private readonly syncMetaRepo: Repository<SyncMetaEntity>,
    private readonly gzReader: GzReaderService,
    private readonly profileReader: ProfileReaderService,
  ) {}

  async syncProfiles(): Promise<number> {
    const profiles = await this.profileReader.readProfiles();
    if (!profiles.length) {
      console.log('  No profiles found to sync');
      return 0;
    }

    const batchSize = 500;
    for (let i = 0; i < profiles.length; i += batchSize) {
      const batch = profiles.slice(i, i + batchSize);
      await this.profileRepo
        .createQueryBuilder()
        .insert()
        .into(StockProfileEntity)
        .values(batch)
        .orUpdate(['shares_outstanding', 'market_cap'], ['symbol'])
        .execute();
    }

    this.profileCache.clear();
    for (const p of profiles) {
      this.profileCache.set(p.symbol, {
        sharesOutstanding: p.shares_outstanding,
        marketCap: p.market_cap,
      });
    }

    console.log(`  Synced ${profiles.length} stock profiles`);
    return profiles.length;
  }

  async syncDateRange(fromDate: string, toDate: string): Promise<void> {
    await this.syncProfiles();

    const allDates = await this.gzReader.listDates();
    const dates = allDates.filter((d) => d >= fromDate && d <= toDate);

    console.log(`Syncing ${dates.length} dates from ${fromDate} to ${toDate}`);

    for (const date of dates) {
      const existing = await this.syncMetaRepo.findOneBy({ date });
      if (existing?.status === 'done') {
        console.log(`  ${date} — already synced, skipping`);
        continue;
      }

      try {
        const start = Date.now();
        const result = await this.syncDate(date);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`  ${date} — screener: ${result.screenerSymbols} symbols → ${result.candleRows} candles, ${result.newsRows} news (${elapsed}s)`);
      } catch (err: any) {
        console.error(`  ${date} — ERROR: ${err.message}`);
        await this.syncMetaRepo.save({ date, status: 'error', candle_rows: 0, news_rows: 0, synced_at: new Date() });
      }
    }
  }

  async syncDate(date: string): Promise<{ candleRows: number; newsRows: number; screenerSymbols: number }> {
    const hasData = await this.gzReader.hasData(date);
    if (!hasData) return { candleRows: 0, newsRows: 0, screenerSymbols: 0 };

    const [barsMap, prevCloseMap, newsArr] = await Promise.all([
      this.gzReader.readBars(date),
      this.gzReader.readPrevClose(date),
      this.gzReader.readNews(date),
    ]);

    // ─── STEP 1: Build daily snapshots for ALL symbols (fast, no indicators) ───
    const snapshots: DailySnapshot[] = [];
    const prevCloseResolved = new Map<string, number>();

    for (const [symbol, rawBars] of barsMap) {
      if (!rawBars.length) continue;

      const sym = symbol.toUpperCase();
      const prevClose = prevCloseMap.get(symbol) ?? prevCloseMap.get(sym) ?? 0;
      if (prevClose <= 0) continue;

      prevCloseResolved.set(sym, prevClose);

      let open = 0;
      let high = -Infinity;
      let low = Infinity;
      let close = 0;
      let volume = 0;

      for (const b of rawBars) {
        if (open === 0) open = b.o;
        if (b.h > high) high = b.h;
        if (b.l < low) low = b.l;
        close = b.c;
        volume += b.v;
      }

      if (close <= 0 || volume <= 0) continue;

      snapshots.push({ symbol: sym, open, high, low, close, volume });
    }

    // ─── STEP 2: Run screener to get stocks in play ───
    const screenerResult = computeScreener({
      snapshots,
      prevCloseMap: prevCloseResolved,
    });

    const screenerSymbols = new Set(screenerResult.symbols.map((s) => s.symbol.toUpperCase()));
    if (screenerSymbols.size === 0) {
      await this.syncMetaRepo.save({ date, status: 'done', candle_rows: 0, news_rows: 0, synced_at: new Date() });
      return { candleRows: 0, newsRows: 0, screenerSymbols: 0 };
    }

    // ─── STEP 3: Only compute indicators & insert for screener symbols ───
    let candleRows = 0;
    let candleBatch: Partial<Candle1mEntity>[] = [];

    for (const symbol of screenerSymbols) {
      const rawBars = barsMap.get(symbol) ?? barsMap.get(symbol.toLowerCase());
      if (!rawBars?.length) continue;

      const prevClose = prevCloseResolved.get(symbol) ?? 0;
      const candles: Candle[] = rawBars.map((b) => ({
        o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
        t: new Date(b.t).getTime(),
      }));

      const profile = this.profileCache.get(symbol);
      const rows = this.computeIncrementalFast(symbol, candles, prevClose, profile);

      for (const row of rows) {
        candleBatch.push(row);
        if (candleBatch.length >= BATCH_SIZE) {
          await this.insertCandleBatch(candleBatch);
          candleRows += candleBatch.length;
          candleBatch = [];
        }
      }
    }

    if (candleBatch.length > 0) {
      await this.insertCandleBatch(candleBatch);
      candleRows += candleBatch.length;
    }

    // ─── STEP 4: News only for screener symbols ───
    let newsRows = 0;
    const newsBatch: Partial<StockNewsEntity>[] = [];
    for (const news of newsArr) {
      for (const sym of news.symbols ?? []) {
        if (!screenerSymbols.has(sym.toUpperCase())) continue;
        newsBatch.push({
          news_id: news.id, symbol: sym.toUpperCase(), date,
          headline: news.headline, summary: news.summary,
          source: news.source,
          created_at: news.created_at ? new Date(news.created_at) : null,
        });
      }
    }
    if (newsBatch.length > 0) {
      await this.newsRepo.createQueryBuilder().insert().into(StockNewsEntity)
        .values(newsBatch).orIgnore().execute();
      newsRows = newsBatch.length;
    }

    await this.syncMetaRepo.save({
      date, status: 'done', candle_rows: candleRows,
      news_rows: newsRows, synced_at: new Date(),
    });

    return { candleRows, newsRows, screenerSymbols: screenerSymbols.size };
  }

  /**
   * O(n) incremental computation per symbol.
   */
  private computeIncrementalFast(
    symbol: string,
    candles: Candle[],
    prevClose: number,
    profile: { sharesOutstanding: number | null; marketCap: number | null } | undefined,
  ): Partial<Candle1mEntity>[] {
    const results: Partial<Candle1mEntity>[] = [];
    const sym = symbol.toUpperCase();
    const firstOpen = candles[0]?.o ?? 0;

    let preMarketHigh = 0;
    let premarketVolume = 0;
    const etCache: { date: string; time: string; minuteOfDay: number }[] = new Array(candles.length);

    for (let i = 0; i < candles.length; i++) {
      const et = timestampToET(candles[i].t);
      etCache[i] = et;
      if (et.minuteOfDay < MARKET_OPEN_MINUTE) {
        if (candles[i].h > preMarketHigh) preMarketHigh = candles[i].h;
        premarketVolume += candles[i].v;
      }
    }

    const gapPct = prevClose > 0 ? ((firstOpen - prevClose) / prevClose) * 100 : 0;

    let vwapCumPV = 0;
    let vwapCumV = 0;
    let ema9 = 0, ema20 = 0;
    const k9 = 2 / (EMA9_PERIOD + 1);
    const k20 = 2 / (EMA20_PERIOD + 1);
    let ema9Sum = 0, ema20Sum = 0;
    let ema9Init = false, ema20Init = false;
    let hod = -Infinity, lod = Infinity;
    const trBuffer: number[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const et = etCache[i];

      if (c.h > hod) hod = c.h;
      if (c.l < lod) lod = c.l;

      const typical = (c.h + c.l + c.c) / 3;
      vwapCumPV += typical * c.v;
      vwapCumV += c.v;
      const vwap = vwapCumV > 0 ? vwapCumPV / vwapCumV : 0;

      if (!ema9Init) {
        ema9Sum += c.c;
        if (i + 1 >= EMA9_PERIOD) { ema9 = ema9Sum / EMA9_PERIOD; ema9Init = true; }
        else ema9 = ema9Sum / (i + 1);
      } else {
        ema9 = c.c * k9 + ema9 * (1 - k9);
      }

      if (!ema20Init) {
        ema20Sum += c.c;
        if (i + 1 >= EMA20_PERIOD) { ema20 = ema20Sum / EMA20_PERIOD; ema20Init = true; }
        else ema20 = ema20Sum / (i + 1);
      } else {
        ema20 = c.c * k20 + ema20 * (1 - k20);
      }

      let atr = 0;
      if (i > 0) {
        const prev = candles[i - 1];
        const tr = Math.max(c.h - c.l, Math.abs(c.h - prev.c), Math.abs(c.l - prev.c));
        trBuffer.push(tr);
        if (trBuffer.length > ATR_PERIOD) trBuffer.shift();
        atr = trBuffer.reduce((s, v) => s + v, 0) / trBuffer.length;
      }

      const session = this.getSessionFast(et.minuteOfDay);

      results.push({
        symbol: sym, date: et.date, candle_idx: i, candle_time_et: et.time,
        open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v,
        vwap, ema9, ema20, atr, high_of_day: hod, low_of_day: lod,
        session, gap_pct: gapPct, premarket_volume: premarketVolume,
        pre_market_high: preMarketHigh, timestamp_ms: c.t,
      });
    }

    return results;
  }

  private getSessionFast(minuteOfDay: number): string {
    if (minuteOfDay < 570) return 'PRE_MARKET';
    if (minuteOfDay < 660) return 'THE_OPEN';
    if (minuteOfDay < 750) return 'LATE_MORNING';
    if (minuteOfDay < 840) return 'MIDDAY';
    if (minuteOfDay < 960) return 'THE_CLOSE';
    return 'AFTER_HOURS';
  }

  private async insertCandleBatch(batch: Partial<Candle1mEntity>[]): Promise<void> {
    await this.candleRepo
      .createQueryBuilder()
      .insert()
      .into(Candle1mEntity)
      .values(batch)
      .orUpdate(
        ['open', 'high', 'low', 'close', 'volume', 'vwap', 'ema9', 'ema20', 'atr',
         'high_of_day', 'low_of_day', 'session', 'gap_pct', 'premarket_volume',
         'pre_market_high', 'timestamp_ms'],
        ['symbol', 'date', 'candle_idx'],
      )
      .execute();
  }
}
