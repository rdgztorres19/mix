import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Candle1mEntity } from '../database/entities/candle-1m.entity';
import { StockNewsEntity } from '../database/entities/stock-news.entity';
import { StockProfileEntity } from '../database/entities/stock-profile.entity';
import { aggregate1mTo5m, VwapCalculator, EmaCalculator, SmaCalculator, RsiCalculator } from '@small-caps/core';
import type { Candle, IndicatorValues } from '@small-caps/shared';

@Injectable()
export class ChartService {
  constructor(
    @InjectRepository(Candle1mEntity)
    private readonly candleRepo: Repository<Candle1mEntity>,
    @InjectRepository(StockNewsEntity)
    private readonly newsRepo: Repository<StockNewsEntity>,
    @InjectRepository(StockProfileEntity)
    private readonly profileRepo: Repository<StockProfileEntity>,
  ) {}

  async getCandles(symbol: string, date: string, timeframe: '1m' | '5m' = '1m') {
    const rows = await this.candleRepo.find({
      where: { symbol: symbol.toUpperCase(), date },
      order: { candle_idx: 'ASC' },
    });

    const candles: Candle[] = rows.map((r) => ({
      o: Number(r.open),
      h: Number(r.high),
      l: Number(r.low),
      c: Number(r.close),
      v: Number(r.volume),
      t: Number(r.timestamp_ms),
    }));

    if (timeframe === '5m') {
      return aggregate1mTo5m(candles);
    }
    return candles;
  }

  async getCandlesWithIndicators(symbol: string, date: string, timeframe: '1m' | '5m' = '1m') {
    const candles = await this.getCandles(symbol, date, timeframe);
    const closes = candles.map((c) => c.c);

    // Compute indicator lines
    const vwapLine = VwapCalculator.calculateLine(candles);
    const ema9Line = EmaCalculator.calculateLine(closes, 9);
    const ema20Line = EmaCalculator.calculateLine(closes, 20);
    const sma50Line = SmaCalculator.calculateLine(closes, 50);
    const sma200Line = SmaCalculator.calculateLine(closes, 200);

    const indicators: IndicatorValues[] = candles.map((_, i) => ({
      vwap: vwapLine[i]?.value ?? null,
      ema9: ema9Line[i],
      ema20: ema20Line[i],
      sma50: sma50Line[i],
      sma200: sma200Line[i],
      atr: 0, // ATR is pre-computed per row, not a line
      rsi: RsiCalculator.calculate(closes.slice(0, i + 1)),
    }));

    // Get pre-computed ATR from DB rows (for 1m only)
    if (timeframe === '1m') {
      const rows = await this.candleRepo.find({
        where: { symbol: symbol.toUpperCase(), date },
        order: { candle_idx: 'ASC' },
        select: ['atr'],
      });
      for (let i = 0; i < Math.min(rows.length, indicators.length); i++) {
        indicators[i].atr = Number(rows[i].atr) || 0;
      }
    }

    // Get key levels directly from DB using session field (fast, no timezone calc)
    const sym = symbol.toUpperCase();
    const [pmLevels] = await this.candleRepo.query(
      `SELECT MAX(high) as pm_high, MIN(low) as pm_low, MAX(gap_pct) as gap_pct
       FROM candle_1m WHERE symbol = ? AND date = ? AND session = 'PRE_MARKET'`,
      [sym, date],
    );

    const firstOpen = candles.length > 0 ? candles[0].o : 0;
    const gapPct = Number(pmLevels?.gap_pct) || 0;
    const prevClose = gapPct !== 0 ? firstOpen / (1 + gapPct / 100) : firstOpen;
    const preMarketHigh = Number(pmLevels?.pm_high) || null;
    const preMarketLow = Number(pmLevels?.pm_low) || null;

    return {
      candles,
      indicators,
      levels: {
        prevClose: prevClose > 0 ? prevClose : null,
        preMarketHigh,
        preMarketLow,
      },
    };
  }

  async getNews(symbol: string, date: string) {
    return this.newsRepo.find({
      where: { symbol: symbol.toUpperCase(), date },
      order: { created_at: 'DESC' },
    });
  }

  async getProfile(symbol: string) {
    return this.profileRepo.findOneBy({ symbol: symbol.toUpperCase() });
  }
}
