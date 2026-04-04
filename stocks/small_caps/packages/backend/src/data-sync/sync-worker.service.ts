import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Candle1mEntity } from '../database/entities/candle-1m.entity';
import { StockNewsEntity } from '../database/entities/stock-news.entity';
import { SyncMetaEntity } from '../database/entities/sync-meta.entity';
import { GzReaderService, type RawBar } from './gz-reader.service';
import { computeCandleRow } from '@small-caps/core';
import type { Candle, SymbolMetadata } from '@small-caps/shared';
import { MARKET_OPEN_MINUTE } from '@small-caps/shared';

const BATCH_SIZE = 5000;

@Injectable()
export class SyncWorkerService {
  constructor(
    @InjectRepository(Candle1mEntity)
    private readonly candleRepo: Repository<Candle1mEntity>,
    @InjectRepository(StockNewsEntity)
    private readonly newsRepo: Repository<StockNewsEntity>,
    @InjectRepository(SyncMetaEntity)
    private readonly syncMetaRepo: Repository<SyncMetaEntity>,
    private readonly gzReader: GzReaderService,
  ) {}

  async syncDateRange(fromDate: string, toDate: string): Promise<void> {
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
        const result = await this.syncDate(date);
        console.log(`  ${date} — ${result.candleRows} candles, ${result.newsRows} news`);
      } catch (err: any) {
        console.error(`  ${date} — ERROR: ${err.message}`);
        await this.syncMetaRepo.save({ date, status: 'error', candle_rows: 0, news_rows: 0, synced_at: new Date() });
      }
    }
  }

  async syncDate(date: string): Promise<{ candleRows: number; newsRows: number }> {
    const hasData = await this.gzReader.hasData(date);
    if (!hasData) return { candleRows: 0, newsRows: 0 };

    const [barsMap, prevCloseMap, newsArr] = await Promise.all([
      this.gzReader.readBars(date),
      this.gzReader.readPrevClose(date),
      this.gzReader.readNews(date),
    ]);

    // Process candles
    let candleRows = 0;
    const candleBatch: Partial<Candle1mEntity>[] = [];

    for (const [symbol, rawBars] of barsMap) {
      if (!rawBars.length) continue;

      const prevClose = prevCloseMap.get(symbol) ?? prevCloseMap.get(symbol.toUpperCase()) ?? 0;
      const candles: Candle[] = rawBars.map((b) => ({
        o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
        t: new Date(b.t).getTime(),
      }));

      // Pre-compute metadata
      const firstOpen = candles[0]?.o ?? 0;
      let preMarketHigh = 0;
      let premarketVolume = 0;
      for (const c of candles) {
        const d = new Date(c.t);
        const h = parseInt(d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }), 10);
        const m = parseInt(d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', minute: 'numeric', hour12: false }), 10);
        if (h * 60 + m < MARKET_OPEN_MINUTE) {
          if (c.h > preMarketHigh) preMarketHigh = c.h;
          premarketVolume += c.v;
        }
      }

      const metadata: SymbolMetadata = {
        priorClose: prevClose,
        preMarketHigh,
        sharesOutstanding: null,
        marketCap: null,
        gapPct: prevClose > 0 ? ((firstOpen - prevClose) / prevClose) * 100 : 0,
        premarketVolume,
      };

      // Compute indicators for each candle incrementally
      for (let i = 0; i < candles.length; i++) {
        const history = candles.slice(0, i + 1);
        const row = computeCandleRow(symbol, history, metadata);

        candleBatch.push({
          symbol: row.symbol,
          date: row.date,
          candle_idx: row.candle_idx,
          candle_time_et: row.candle_time_et,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          vwap: row.vwap,
          ema9: row.ema9,
          ema20: row.ema20,
          atr: row.atr,
          high_of_day: row.high_of_day,
          low_of_day: row.low_of_day,
          session: row.session,
          gap_pct: row.gap_pct,
          premarket_volume: row.premarket_volume,
          pre_market_high: row.pre_market_high,
          timestamp_ms: row.timestamp_ms,
        });

        if (candleBatch.length >= BATCH_SIZE) {
          await this.insertCandleBatch(candleBatch);
          candleRows += candleBatch.length;
          candleBatch.length = 0;
        }
      }
    }

    // Flush remaining
    if (candleBatch.length > 0) {
      await this.insertCandleBatch(candleBatch);
      candleRows += candleBatch.length;
    }

    // Process news
    let newsRows = 0;
    const newsBatch: Partial<StockNewsEntity>[] = [];
    for (const news of newsArr) {
      for (const sym of news.symbols ?? []) {
        newsBatch.push({
          news_id: news.id,
          symbol: sym,
          date,
          headline: news.headline,
          summary: news.summary,
          source: news.source,
          created_at: news.created_at ? new Date(news.created_at) : null,
        });
      }
    }
    if (newsBatch.length > 0) {
      await this.newsRepo
        .createQueryBuilder()
        .insert()
        .into(StockNewsEntity)
        .values(newsBatch)
        .orIgnore()
        .execute();
      newsRows = newsBatch.length;
    }

    // Update sync meta
    await this.syncMetaRepo.save({
      date,
      status: 'done',
      candle_rows: candleRows,
      news_rows: newsRows,
      synced_at: new Date(),
    });

    return { candleRows, newsRows };
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
