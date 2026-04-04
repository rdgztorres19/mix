import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Candle1mEntity } from '../database/entities/candle-1m.entity';
import { SyncMetaEntity } from '../database/entities/sync-meta.entity';
import { RedisService } from '../redis/redis.service';
import { computeScreener, type DailySnapshot } from '@small-caps/core';
import type { ScreenerResult, ScreenerSymbol, ScreenerRankType } from '@small-caps/shared';
import { SCREENER_CACHE_TTL_SECONDS } from '@small-caps/shared';

@Injectable()
export class ScreenerService {
  constructor(
    @InjectRepository(Candle1mEntity)
    private readonly candleRepo: Repository<Candle1mEntity>,
    @InjectRepository(SyncMetaEntity)
    private readonly syncMetaRepo: Repository<SyncMetaEntity>,
    private readonly redis: RedisService,
  ) {}

  async getScreener(date: string): Promise<ScreenerResult> {
    const cacheKey = `screener:eod:${date}`;

    // Check Redis cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as ScreenerResult;
    }

    // Compute from DB
    const result = await this.computeFromDb(date);

    // Cache in Redis
    await this.redis.set(cacheKey, JSON.stringify(result), SCREENER_CACHE_TTL_SECONDS);

    return result;
  }

  private async computeFromDb(date: string): Promise<ScreenerResult> {
    // Single efficient query: aggregate + first/last candle info in one pass
    const rows: any[] = await this.candleRepo.query(`
      SELECT
        symbol,
        MAX(high) AS high,
        MIN(low) AS low,
        SUM(volume) AS total_volume,
        MAX(gap_pct) AS gap_pct,
        SUBSTRING_INDEX(GROUP_CONCAT(open ORDER BY candle_idx ASC), ',', 1) AS first_open,
        SUBSTRING_INDEX(GROUP_CONCAT(\`close\` ORDER BY candle_idx DESC), ',', 1) AS last_close
      FROM candle_1m
      WHERE date = ?
      GROUP BY symbol
    `, [date]);

    const prevCloseMap = new Map<string, number>();
    const snapshots: DailySnapshot[] = [];

    for (const row of rows) {
      const symbol = row.symbol as string;
      const dayOpen = parseFloat(row.first_open) || 0;
      const close = parseFloat(row.last_close) || 0;
      const high = parseFloat(row.high) || 0;
      const low = parseFloat(row.low) || 0;
      const volume = parseInt(row.total_volume, 10) || 0;
      const gapPct = parseFloat(row.gap_pct) || 0;

      const prevClose = gapPct !== 0 ? dayOpen / (1 + gapPct / 100) : dayOpen;
      if (prevClose > 0) prevCloseMap.set(symbol, prevClose);

      snapshots.push({ symbol, open: dayOpen, high, low, close, volume });
    }

    const output = computeScreener({ snapshots, prevCloseMap });
    return { date, symbols: output.symbols };
  }

  /**
   * Returns symbols already stored in DB for this date.
   * No screener computation — just reads what the sync inserted.
   */
  async getStocksForDate(date: string): Promise<ScreenerResult> {
    const rows: any[] = await this.candleRepo.query(`
      SELECT
        c.symbol,
        MAX(c.high) AS high,
        MIN(c.low) AS low,
        SUM(c.volume) AS total_volume,
        MAX(c.gap_pct) AS gap_pct,
        SUBSTRING_INDEX(GROUP_CONCAT(c.open ORDER BY c.candle_idx ASC), ',', 1) AS first_open,
        SUBSTRING_INDEX(GROUP_CONCAT(c.\`close\` ORDER BY c.candle_idx DESC), ',', 1) AS last_close,
        MAX(CASE WHEN c.candle_time_et >= '09:00' AND c.candle_time_et < '11:30' THEN c.high END) AS morning_high,
        SUBSTRING_INDEX(GROUP_CONCAT(
          CASE WHEN c.candle_time_et >= '09:00' AND c.candle_time_et <= '09:05' THEN c.open END
          ORDER BY c.candle_idx ASC
        ), ',', 1) AS open_at_9
      FROM candle_1m c
      WHERE c.date = ?
      GROUP BY c.symbol
      ORDER BY MAX(c.gap_pct) DESC
    `, [date]);

    const symbols = rows.map((row, idx) => {
      const dayOpen = parseFloat(row.first_open) || 0;
      const close = parseFloat(row.last_close) || 0;
      const gapPct = parseFloat(row.gap_pct) || 0;
      const prevClose = gapPct !== 0 ? dayOpen / (1 + gapPct / 100) : dayOpen;
      const changePct = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;

      const openAt9 = parseFloat(row.open_at_9) || 0;
      const morningHigh = parseFloat(row.morning_high) || 0;
      const morningPct = openAt9 > 0 ? ((morningHigh - openAt9) / openAt9) * 100 : 0;

      return {
        symbol: row.symbol as string,
        rank: idx + 1,
        gapPct,
        changePct,
        morningPct,
        volume: parseInt(row.total_volume, 10) || 0,
        rankTypes: [] as ScreenerRankType[],
        previousClose: prevClose,
        open: dayOpen,
        close,
        high: parseFloat(row.high) || 0,
        low: parseFloat(row.low) || 0,
      };
    });

    return { date, symbols };
  }

  /** Get available dates that have been synced — reads from sync_meta (fast, no full table scan). */
  async getAvailableDates(): Promise<string[]> {
    const rows = await this.syncMetaRepo.find({
      where: { status: 'done' },
      order: { date: 'DESC' },
    });
    return rows.map((r) => String(r.date).slice(0, 10));
  }
}
