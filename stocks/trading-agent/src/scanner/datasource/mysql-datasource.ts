import { Injectable, Logger } from '@nestjs/common';
import { MysqlTrainingRepository } from '../mysql/mysql-training.repository';
import type { Candle, StockSnapshot, VwapPoint } from '../scanner.service';
import type { IStockDataSource } from './stock-datasource.interface';
import { VwapCalculator } from '../../small-cap-trading';

/**
 * Historical data from MySQL (stock_training DB, populated by stock-training sync).
 */
@Injectable()
export class MysqlDataSource implements IStockDataSource {
  private readonly logger = new Logger(MysqlDataSource.name);

  constructor(private readonly mysqlRepo: MysqlTrainingRepository) {}

  async getStockSnapshot(
    ticker: string,
    options?: { cutoffMs?: number; timeframe?: '1m' | '5m'; date?: string },
  ): Promise<StockSnapshot> {
    const dateStr = options?.date;
    if (!dateStr) {
      this.logger.warn('MysqlDataSource requires date for historical data');
      return this.emptySnapshot(ticker);
    }
    const rows = await this.mysqlRepo.getTickerRowsForDate(ticker, dateStr, '1m');
    if (!rows.length) {
      this.logger.warn(`No MySQL data for ${ticker} on ${dateStr}`);
      return this.emptySnapshot(ticker);
    }
    const candles1m = this.rowsToCandles(rows, dateStr);
    if (!candles1m.length) return this.emptySnapshot(ticker);

    // Apply cutoff
    let filtered = candles1m;
    if (options?.cutoffMs) {
      filtered = candles1m.filter((c) => c.t <= options!.cutoffMs!);
      if (!filtered.length) return this.emptySnapshot(ticker);
    }

    const candles5m = this.aggregate1mTo5m(filtered);
    const timeframe = options?.timeframe ?? '5m';
    const candlesForMetrics = timeframe === '1m' ? filtered : candles5m;
    const latest = candlesForMetrics[candlesForMetrics.length - 1]!;
    const price = latest.c;

    const high_of_day = Math.max(...filtered.map((c) => c.h));
    const low_of_day = Math.min(...filtered.map((c) => c.l));
    const volume = filtered.reduce((s, c) => s + c.v, 0);
    const avg_volume = this.estimateAvgFromRows(rows);
    const relative_volume = avg_volume > 0 ? volume / avg_volume : 0;

    const lastRow = rows[rows.length - 1] as Record<string, unknown>;
    const vwap = lastRow?.vwap != null ? Number(lastRow.vwap) : VwapCalculator.calculate(candlesForMetrics);
    const vwap_line = VwapCalculator.calculateLine(candlesForMetrics);
    const closes = candlesForMetrics.map((c) => c.c);
    const ema9 = lastRow?.ema9 != null ? Number(lastRow.ema9) : null;
    const ema20 = lastRow?.ema20 != null ? Number(lastRow.ema20) : null;
    const atr = lastRow?.atr != null ? Number(lastRow.atr) : 0.5;
    const pre_market_high = lastRow?.pre_market_high != null ? Number(lastRow.pre_market_high) : null;
    const change_pct = lastRow?.change_pct_at_candle != null ? Number(lastRow.change_pct_at_candle) : 0;

    return {
      ticker: ticker.toUpperCase(),
      price,
      vwap: vwap > 0 ? vwap : null,
      vwap_line,
      ema9: ema9 != null && ema9 > 0 ? ema9 : null,
      ema20: ema20 != null && ema20 > 0 ? ema20 : null,
      volume,
      avg_volume,
      relative_volume,
      change_pct,
      pre_market_high,
      candles_1min: filtered,
      candles_5min: candles5m,
      atr,
      high_of_day,
      low_of_day,
    };
  }

  private rowsToCandles(rows: Record<string, unknown>[], dateStr: string): Candle[] {
    const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
    const candles: Candle[] = [];
    for (const r of rows) {
      const timeEt = String(r.candle_time_et ?? '00:00');
      const [h, m] = timeEt.split(':').map((x) => parseInt(String(x), 10) || 0);
      const [, mo, d] = String(dateStr).split('-').map(Number);
      const isEDT = (mo > 3 && mo < 11) || (mo === 3 && d >= 8) || (mo === 11 && d < 7);
      const offset = isEDT ? '-04:00' : '-05:00';
      const ts = new Date(`${dateStr}T${pad(h)}:${pad(m)}:00${offset}`).getTime();
      candles.push({
        o: Number(r.open ?? 0),
        h: Number(r.high ?? 0),
        l: Number(r.low ?? 0),
        c: Number(r.close ?? 0),
        v: Number(r.volume ?? 0),
        t: ts,
      });
    }
    return candles;
  }

  private aggregate1mTo5m(candles: Candle[]): Candle[] {
    const groups: Record<number, Candle[]> = {};
    for (const c of candles) {
      const bucket = Math.floor(c.t / (5 * 60 * 1000)) * (5 * 60 * 1000);
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(c);
    }
    return Object.keys(groups)
      .map(Number)
      .sort((a, b) => a - b)
      .map((bucket) => {
        const g = groups[bucket]!;
        return {
          o: g[0]!.o,
          h: Math.max(...g.map((x) => x.h)),
          l: Math.min(...g.map((x) => x.l)),
          c: g[g.length - 1]!.c,
          v: g.reduce((s, x) => s + x.v, 0),
          t: bucket,
        };
      });
  }

  private estimateAvgFromRows(rows: Record<string, unknown>[]): number {
    const volRel = rows.map((r) => Number(r.volume_rel ?? r.volume ?? 0));
    if (!volRel.length) return 1;
    const lastVol = Number(rows[rows.length - 1]?.volume ?? 0);
    const lastRel = Number(rows[rows.length - 1]?.volume_rel ?? 0);
    if (lastRel > 0 && lastVol > 0) return lastVol / lastRel;
    return lastVol || 1;
  }

  async getAvailableDates(): Promise<string[]> {
    return this.mysqlRepo.getAvailableDates();
  }

  private emptySnapshot(ticker: string): StockSnapshot {
    return {
      ticker: ticker.toUpperCase(),
      price: 0,
      vwap: null,
      vwap_line: [] as VwapPoint[],
      ema9: null,
      ema20: null,
      volume: 0,
      avg_volume: 1,
      relative_volume: 0,
      change_pct: 0,
      pre_market_high: null,
      candles_1min: [],
      candles_5min: [],
      atr: 0.5,
      high_of_day: 0,
      low_of_day: 0,
    };
  }
}
