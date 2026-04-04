import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Candle1mEntity } from '../database/entities/candle-1m.entity';
import { RedisService } from '../redis/redis.service';
import { computeScreener, type DailySnapshot } from '@small-caps/core';
import type { ScreenerResult, ScreenerSymbol } from '@small-caps/shared';
import { SCREENER_CACHE_TTL_SECONDS } from '@small-caps/shared';

@Injectable()
export class ScreenerService {
  constructor(
    @InjectRepository(Candle1mEntity)
    private readonly candleRepo: Repository<Candle1mEntity>,
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
    // Build daily snapshots from candle_1m: aggregate OHLCV per symbol for the day
    const rows = await this.candleRepo
      .createQueryBuilder('c')
      .select('c.symbol', 'symbol')
      .addSelect('MIN(c.open)', 'first_open')
      .addSelect('MAX(c.high)', 'high')
      .addSelect('MIN(c.low)', 'low')
      .addSelect('SUM(c.volume)', 'total_volume')
      .addSelect('MAX(c.gap_pct)', 'gap_pct')
      .where('c.date = :date', { date })
      .groupBy('c.symbol')
      .getRawMany();

    // Get close from last candle of day per symbol
    const lastCandles = await this.candleRepo
      .createQueryBuilder('c')
      .select('c.symbol', 'symbol')
      .addSelect('c.close', 'close')
      .addSelect('c.open', 'day_open')
      .where('c.date = :date', { date })
      .andWhere('c.candle_idx = (SELECT MAX(c2.candle_idx) FROM candle_1m c2 WHERE c2.symbol = c.symbol AND c2.date = :date)')
      .getRawMany();

    const closeMap = new Map<string, { close: number; dayOpen: number }>();
    for (const r of lastCandles) {
      closeMap.set(r.symbol, { close: parseFloat(r.close), dayOpen: parseFloat(r.day_open) });
    }

    // Get first open per symbol
    const firstOpenCandles = await this.candleRepo
      .createQueryBuilder('c')
      .select('c.symbol', 'symbol')
      .addSelect('c.open', 'first_open')
      .where('c.date = :date', { date })
      .andWhere('c.candle_idx = (SELECT MIN(c2.candle_idx) FROM candle_1m c2 WHERE c2.symbol = c.symbol AND c2.date = :date AND c2.session != :pm)', { pm: 'PRE_MARKET' })
      .getRawMany();

    const openMap = new Map<string, number>();
    for (const r of firstOpenCandles) {
      openMap.set(r.symbol, parseFloat(r.first_open));
    }

    // Build prev close map from gap_pct + open: prevClose = open / (1 + gapPct/100)
    const prevCloseMap = new Map<string, number>();
    const snapshots: DailySnapshot[] = [];

    for (const row of rows) {
      const symbol = row.symbol as string;
      const closeData = closeMap.get(symbol);
      const dayOpen = openMap.get(symbol) ?? closeData?.dayOpen ?? 0;
      const close = closeData?.close ?? 0;
      const high = parseFloat(row.high);
      const low = parseFloat(row.low);
      const volume = parseInt(row.total_volume, 10);
      const gapPct = parseFloat(row.gap_pct) || 0;

      const prevClose = gapPct !== 0 ? dayOpen / (1 + gapPct / 100) : dayOpen;
      if (prevClose > 0) {
        prevCloseMap.set(symbol, prevClose);
      }

      snapshots.push({ symbol, open: dayOpen, high, low, close, volume });
    }

    const output = computeScreener({ snapshots, prevCloseMap });

    return { date, symbols: output.symbols };
  }

  /** Get available dates that have been synced. */
  async getAvailableDates(): Promise<string[]> {
    const rows = await this.candleRepo
      .createQueryBuilder('c')
      .select('DISTINCT c.date', 'date')
      .orderBy('c.date', 'DESC')
      .getRawMany();
    return rows.map((r) => r.date);
  }
}
