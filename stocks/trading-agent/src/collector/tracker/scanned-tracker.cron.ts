import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScannedTrackerService, ScannedSymbolData } from './scanned-tracker.service';
import { AlpacaDataSource } from '../../scanner/datasource/alpaca-datasource';
import { EmaCalculator } from '../../small-cap-trading/indicators/ema.calculator';
import { Candle } from '../../scanner/scanner.service';

type TrackerMetrics = {
  premarket_volume: number;
  premarket_dollar_volume: number | null;
  volume: number;
  dollar_volume: number | null;
  close: number;
  ema9: number;
  gap_pct: number;
  passes_pre_filter: boolean;
};

type DailyFrozenMetrics = {
  tradingDay: string;
  priorClose: number | null;
  gapPct: number | null;
  premarketVolume: number | null;
  premarketDollarVolume: number | null;
  isFinalized: boolean;
  fetchedAt: number;
};

type SymbolBarsCache = {
  symbol: string;
  candles: Candle[];
  fetchedAt: number;
  rangeStart: string;
  rangeEnd: string;
};

type FrozenMetricsResult = {
  frozen: DailyFrozenMetrics;
  sourceCandles?: Candle[];
};

@Injectable()
export class ScannedTrackerCron {
  private readonly logger = new Logger(ScannedTrackerCron.name);

  private static readonly NEW_YORK_TIMEZONE = 'America/New_York';

  private static readonly TRACKING_START_HOUR_ET = 4;
  private static readonly TRACKING_END_HOUR_ET = 12;

  private static readonly PREMARKET_START_HOUR_ET = 4;
  private static readonly MARKET_OPEN_HOUR_ET = 9;
  private static readonly MARKET_OPEN_MINUTE_ET = 30;

  private static readonly EMA_PERIOD = 9;
  private static readonly REQUEST_DELAY_MS = 200;

  private static readonly PREMARKET_DOLLAR_VOLUME_THRESHOLD = 407568.983475;

  /**
   * Rango largo para encontrar prior close real
   * incluso con fines de semana / feriados.
   */
  private static readonly LONG_LOOKBACK_DAYS = 7;

  /**
   * Rango corto para live bars.
   * Debe cubrir al menos EMA9 cómodamente.
   */
  private static readonly LIVE_LOOKBACK_MINUTES = 45;

  /**
   * Cache live: si el cron corre cada minuto,
   * 45s-60s evita múltiples calls innecesarias.
   */
  private static readonly LIVE_BARS_TTL_MS = 45_000;

  /**
   * Antes de 9:30, premarket/gap todavía cambian.
   * No hace falta recalcularlos cada minuto exacto.
   */
  private static readonly PREMARKET_FROZEN_TTL_MS = 120_000;

  private readonly frozenMetricsCache = new Map<string, DailyFrozenMetrics>();
  private readonly liveBarsCache = new Map<string, SymbolBarsCache>();

  /**
   * Evita requests duplicados simultáneos por símbolo.
   */
  private readonly inFlightLongFetches = new Map<string, Promise<Candle[]>>();
  private readonly inFlightLiveFetches = new Map<string, Promise<Candle[]>>();

  constructor(
    private readonly trackerService: ScannedTrackerService,
    private readonly alpacaDataSource: AlpacaDataSource,
  ) { }

  @Cron('* * * * 1-5')
  async runScannerTrackerRefresh(): Promise<void> {
    if (!this.isWithinTrackingHours()) {
      return;
    }

    const trackedSymbols = this.trackerService.getTrackedSymbols();
    if (trackedSymbols.length === 0) {
      return;
    }

    this.evictOldCachesIfNeeded();

    this.logger.log(`Refreshing tracking metrics for ${trackedSymbols.length} symbols...`);

    for (const symbolData of trackedSymbols) {
      await this.refreshSymbolSafely(symbolData);
      await this.delay(ScannedTrackerCron.REQUEST_DELAY_MS);
    }
  }

  private async refreshSymbolSafely(symbolData: ScannedSymbolData): Promise<void> {
    try {
      await this.refreshSymbolMetrics(symbolData);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to refresh metrics for ${symbolData.symbol}: ${message}`);
    }
  }

  private async refreshSymbolMetrics(symbolData: ScannedSymbolData): Promise<void> {
    const nowEt = this.getNowInEasternTime();
    const tradingDay = this.toEasternDateString(nowEt);

    const todayPremarketStartMs = this.createEasternTimeBoundary(
      nowEt,
      ScannedTrackerCron.PREMARKET_START_HOUR_ET,
      0,
    ).getTime();

    const marketOpenMs = this.createEasternTimeBoundary(
      nowEt,
      ScannedTrackerCron.MARKET_OPEN_HOUR_ET,
      ScannedTrackerCron.MARKET_OPEN_MINUTE_ET,
    ).getTime();

    const frozenResult = await this.getOrComputeFrozenMetrics(
      symbolData.symbol,
      tradingDay,
      nowEt,
      todayPremarketStartMs,
      marketOpenMs,
    );

    /**
     * Si el cálculo frozen vino de un fetch largo, reutilizamos esas velas
     * para evitar otra llamada live innecesaria.
     */
    if (frozenResult.sourceCandles && frozenResult.sourceCandles.length > 0) {
      this.seedLiveBarsCacheFromCandles(symbolData.symbol, frozenResult.sourceCandles);
    }

    const liveCandles = await this.getOrFetchLiveCandles(symbolData.symbol, nowEt);
    if (liveCandles.length === 0) {
      return;
    }

    const liveMetrics = this.calculateLiveMetrics(liveCandles);
    const passesPreFilter = this.passesPreFilter({
      close: liveMetrics.close,
      ema9: liveMetrics.ema9,
      premarketDollarVolume: frozenResult.frozen.premarketDollarVolume,
    });

    await this.trackerService.updateCalculatedMetrics(symbolData.symbol, {
      premarket_volume: frozenResult.frozen.premarketVolume ?? 0,
      premarket_dollar_volume: frozenResult.frozen.premarketDollarVolume,
      volume: liveMetrics.volume,
      dollar_volume: liveMetrics.dollarVolume,
      close: liveMetrics.close,
      ema9: liveMetrics.ema9,
      gap_pct: frozenResult.frozen.gapPct ?? 0,
      passes_pre_filter: passesPreFilter,
    });
  }

  private async getOrComputeFrozenMetrics(
    symbol: string,
    tradingDay: string,
    nowEt: Date,
    todayPremarketStartMs: number,
    marketOpenMs: number,
  ): Promise<FrozenMetricsResult> {
    const cacheKey = this.getFrozenCacheKey(symbol, tradingDay);
    const cached = this.frozenMetricsCache.get(cacheKey);
    const nowMs = Date.now();
    const premarketEnded = this.hasPremarketEnded(nowEt);

    if (cached) {
      if (cached.isFinalized) {
        return { frozen: cached };
      }

      const cacheStillFresh =
        nowMs - cached.fetchedAt < ScannedTrackerCron.PREMARKET_FROZEN_TTL_MS;

      if (!premarketEnded && cacheStillFresh) {
        return { frozen: cached };
      }
    }

    const longCandles = await this.fetchLongRangeCandles(symbol, nowEt);
    if (longCandles.length === 0) {
      return {
        frozen:
          cached ??
          this.createEmptyFrozenMetrics(tradingDay, premarketEnded),
      };
    }

    const computed = this.computeFrozenMetricsFromCandles(
      tradingDay,
      longCandles,
      todayPremarketStartMs,
      marketOpenMs,
      premarketEnded,
    );

    this.frozenMetricsCache.set(cacheKey, computed);

    return {
      frozen: computed,
      sourceCandles: longCandles,
    };
  }

  private computeFrozenMetricsFromCandles(
    tradingDay: string,
    candles: Candle[],
    todayPremarketStartMs: number,
    marketOpenMs: number,
    isFinalized: boolean,
  ): DailyFrozenMetrics {
    const priorClose = this.getPreviousRegularClose(candles, todayPremarketStartMs);
    const premarketCandles = candles.filter(
      candle => candle.t >= todayPremarketStartMs && candle.t < marketOpenMs,
    );

    const referencePremarketCandle =
      premarketCandles[premarketCandles.length - 1] ?? null;

    const referencePrice =
      referencePremarketCandle?.c ??
      candles[candles.length - 1]?.c ??
      0;

    const premarketVolume = this.sumVolume(premarketCandles);
    const premarketDollarVolume = this.safeMultiply(referencePrice, premarketVolume);
    const gapPct = this.calculateGapPercent(referencePrice, priorClose ?? 0);

    return {
      tradingDay,
      priorClose,
      gapPct,
      premarketVolume,
      premarketDollarVolume,
      isFinalized,
      fetchedAt: Date.now(),
    };
  }

  /**
   * Busca el previous REGULAR close.
   * Toma la última vela antes de 4:00 AM ET de hoy,
   * pero intenta preferir una vela de sesión regular previa
   * (<= 16:00 ET del último día hábil anterior).
   *
   * Si no puede, cae en la última vela disponible anterior.
   */
  private getPreviousRegularClose(
    candles: Candle[],
    todayPremarketStartMs: number,
  ): number | null {
    const previousDayCandles = candles.filter(c => c.t < todayPremarketStartMs);
    if (previousDayCandles.length === 0) {
      return null;
    }

    const groupedByDate = new Map<string, Candle[]>();

    for (const candle of previousDayCandles) {
      const dateKey = this.toEasternDateString(new Date(candle.t));
      const list = groupedByDate.get(dateKey) ?? [];
      list.push(candle);
      groupedByDate.set(dateKey, list);
    }

    const datesDesc = Array.from(groupedByDate.keys()).sort().reverse();

    for (const dateKey of datesDesc) {
      const dayCandles = (groupedByDate.get(dateKey) ?? []).sort((a, b) => a.t - b.t);

      const regularSessionCandles = dayCandles.filter(candle =>
        this.isWithinRegularHoursEt(candle.t),
      );

      if (regularSessionCandles.length > 0) {
        return regularSessionCandles[regularSessionCandles.length - 1].c;
      }
    }

    return previousDayCandles[previousDayCandles.length - 1].c;
  }

  private async getOrFetchLiveCandles(symbol: string, nowEt: Date): Promise<Candle[]> {
    const cacheKey = this.getLiveCacheKey(symbol);
    const cached = this.liveBarsCache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < ScannedTrackerCron.LIVE_BARS_TTL_MS) {
      return cached.candles;
    }

    const candles = await this.fetchShortRangeCandles(symbol, nowEt);
    if (candles.length > 0) {
      this.liveBarsCache.set(cacheKey, {
        symbol,
        candles,
        fetchedAt: Date.now(),
        rangeStart: this.buildShortFetchRange(nowEt).start,
        rangeEnd: this.buildShortFetchRange(nowEt).end,
      });
    }

    return candles;
  }

  private calculateLiveMetrics(candles: Candle[]): {
    close: number;
    volume: number;
    dollarVolume: number | null;
    ema9: number;
  } {
    const latestCandle = candles[candles.length - 1];
    const close = latestCandle.c;
    const volume = latestCandle.v;

    const ema9 = EmaCalculator.calculate(
      candles.map(c => c.c),
      ScannedTrackerCron.EMA_PERIOD,
    );

    return {
      close,
      volume,
      dollarVolume: this.safeMultiply(close, volume),
      ema9,
    };
  }

  private async fetchLongRangeCandles(symbol: string, nowEt: Date): Promise<Candle[]> {
    const inFlight = this.inFlightLongFetches.get(symbol);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.doFetchLongRangeCandles(symbol, nowEt);

    this.inFlightLongFetches.set(symbol, promise);

    try {
      return await promise;
    } finally {
      this.inFlightLongFetches.delete(symbol);
    }
  }

  private async doFetchLongRangeCandles(symbol: string, nowEt: Date): Promise<Candle[]> {
    const range = this.buildLongFetchRange(nowEt);

    const response = await this.alpacaDataSource.fetchBarsFromAlpacaDirect({
      symbol,
      timeframe: '1Min',
      start: range.start,
      end: range.end,
      feed: 'sip',
      limit: 10000,
    });

    const bars = response?.bars ?? [];
    if (bars.length === 0) {
      this.logger.warn(`No long-range bars returned for ${symbol} between ${range.start} and ${range.end}`);
      return [];
    }

    return bars
      .map(bar => this.mapAlpacaBarToCandle(bar))
      .filter(candle => this.isValidCandle(candle))
      .sort((a, b) => a.t - b.t);
  }

  private async fetchShortRangeCandles(symbol: string, nowEt: Date): Promise<Candle[]> {
    const inFlight = this.inFlightLiveFetches.get(symbol);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.doFetchShortRangeCandles(symbol, nowEt);

    this.inFlightLiveFetches.set(symbol, promise);

    try {
      return await promise;
    } finally {
      this.inFlightLiveFetches.delete(symbol);
    }
  }

  private async doFetchShortRangeCandles(symbol: string, nowEt: Date): Promise<Candle[]> {
    const range = this.buildShortFetchRange(nowEt);

    const response = await this.alpacaDataSource.fetchBarsFromAlpacaDirect({
      symbol,
      timeframe: '1Min',
      start: range.start,
      end: range.end,
      feed: 'sip',
      limit: 120,
    });

    const bars = response?.bars ?? [];
    if (bars.length === 0) {
      this.logger.warn(`No live bars returned for ${symbol} between ${range.start} and ${range.end}`);
      return [];
    }

    return bars
      .map(bar => this.mapAlpacaBarToCandle(bar))
      .filter(candle => this.isValidCandle(candle))
      .sort((a, b) => a.t - b.t);
  }

  private seedLiveBarsCacheFromCandles(symbol: string, sourceCandles: Candle[]): void {
    const recentCutoffMs = Date.now() - ScannedTrackerCron.LIVE_LOOKBACK_MINUTES * 60_000;
    const recentCandles = sourceCandles.filter(candle => candle.t >= recentCutoffMs);

    if (recentCandles.length === 0) {
      return;
    }

    this.liveBarsCache.set(this.getLiveCacheKey(symbol), {
      symbol,
      candles: recentCandles.sort((a, b) => a.t - b.t),
      fetchedAt: Date.now(),
      rangeStart: new Date(recentCandles[0].t).toISOString(),
      rangeEnd: new Date(recentCandles[recentCandles.length - 1].t).toISOString(),
    });
  }

  private buildLongFetchRange(nowEt: Date): { start: string; end: string } {
    const startEt = new Date(nowEt);
    startEt.setDate(startEt.getDate() - ScannedTrackerCron.LONG_LOOKBACK_DAYS);
    startEt.setHours(0, 0, 0, 0);

    return {
      start: this.toIsoUtcString(startEt),
      end: this.toIsoUtcString(nowEt),
    };
  }

  private buildShortFetchRange(nowEt: Date): { start: string; end: string } {
    const start = new Date(nowEt.getTime() - ScannedTrackerCron.LIVE_LOOKBACK_MINUTES * 60_000);

    return {
      start: this.toIsoUtcString(start),
      end: this.toIsoUtcString(nowEt),
    };
  }

  private mapAlpacaBarToCandle(bar: any): Candle {
    return {
      t: this.toBarTimestampMs(bar.t),
      o: Number(bar.o ?? 0),
      h: Number(bar.h ?? 0),
      l: Number(bar.l ?? 0),
      c: Number(bar.c ?? 0),
      v: Number(bar.v ?? 0),
    };
  }

  private isValidCandle(candle: Candle): boolean {
    return (
      Number.isFinite(candle.t) &&
      Number.isFinite(candle.o) &&
      Number.isFinite(candle.h) &&
      Number.isFinite(candle.l) &&
      Number.isFinite(candle.c) &&
      Number.isFinite(candle.v)
    );
  }

  private toBarTimestampMs(value: string | number): number {
    if (typeof value === 'number') {
      return value > 9999999999 ? value : value * 1000;
    }

    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private calculateGapPercent(currentPrice: number, priorClose: number): number {
    if (!Number.isFinite(currentPrice) || !Number.isFinite(priorClose) || priorClose <= 0) {
      return 0;
    }

    return ((currentPrice - priorClose) / priorClose) * 100;
  }

  private safeMultiply(a: number, b: number): number | null {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return null;
    }

    const result = a * b;
    return Number.isFinite(result) ? result : null;
  }

  private sumVolume(candles: Candle[]): number {
    return candles.reduce((total, candle) => total + candle.v, 0);
  }

  private passesPreFilter(params: {
    close: number;
    ema9: number;
    premarketDollarVolume: number | null;
  }): boolean {
    const { close, ema9, premarketDollarVolume } = params;

    return (
      premarketDollarVolume !== null &&
      Number.isFinite(close) &&
      Number.isFinite(ema9) &&
      premarketDollarVolume <= ScannedTrackerCron.PREMARKET_DOLLAR_VOLUME_THRESHOLD &&
      close > ema9
    );
  }

  private hasPremarketEnded(nowEt: Date): boolean {
    const marketOpen = this.createEasternTimeBoundary(
      nowEt,
      ScannedTrackerCron.MARKET_OPEN_HOUR_ET,
      ScannedTrackerCron.MARKET_OPEN_MINUTE_ET,
    );

    return nowEt.getTime() >= marketOpen.getTime();
  }

  private isWithinTrackingHours(): boolean {
    const nowEt = this.getNowInEasternTime();
    const hour = nowEt.getHours();

    return (
      hour >= ScannedTrackerCron.TRACKING_START_HOUR_ET &&
      hour < ScannedTrackerCron.TRACKING_END_HOUR_ET
    );
  }

  private isWithinRegularHoursEt(timestampMs: number): boolean {
    const dateEt = new Date(
      new Date(timestampMs).toLocaleString('en-US', {
        timeZone: ScannedTrackerCron.NEW_YORK_TIMEZONE,
      }),
    );

    const hours = dateEt.getHours();
    const minutes = dateEt.getMinutes();
    const totalMinutes = hours * 60 + minutes;

    const regularOpenMinutes = 9 * 60 + 30;
    const regularCloseMinutes = 16 * 60;

    return totalMinutes >= regularOpenMinutes && totalMinutes <= regularCloseMinutes;
  }

  private createEmptyFrozenMetrics(
    tradingDay: string,
    isFinalized: boolean,
  ): DailyFrozenMetrics {
    return {
      tradingDay,
      priorClose: null,
      gapPct: null,
      premarketVolume: null,
      premarketDollarVolume: null,
      isFinalized,
      fetchedAt: Date.now(),
    };
  }

  private getFrozenCacheKey(symbol: string, tradingDay: string): string {
    return `${symbol}:${tradingDay}`;
  }

  private getLiveCacheKey(symbol: string): string {
    return symbol;
  }

  private evictOldCachesIfNeeded(): void {
    const todayEt = this.toEasternDateString(this.getNowInEasternTime());

    for (const [key, value] of this.frozenMetricsCache.entries()) {
      if (value.tradingDay !== todayEt) {
        this.frozenMetricsCache.delete(key);
      }
    }

    const now = Date.now();
    for (const [key, value] of this.liveBarsCache.entries()) {
      if (now - value.fetchedAt > ScannedTrackerCron.LIVE_BARS_TTL_MS * 4) {
        this.liveBarsCache.delete(key);
      }
    }
  }

  private getNowInEasternTime(): Date {
    return new Date(
      new Date().toLocaleString('en-US', {
        timeZone: ScannedTrackerCron.NEW_YORK_TIMEZONE,
      }),
    );
  }

  private createEasternTimeBoundary(baseDate: Date, hour: number, minute: number): Date {
    const boundary = new Date(baseDate);
    boundary.setHours(hour, minute, 0, 0);
    return boundary;
  }

  private toEasternDateString(date: Date): string {
    return date.toLocaleDateString('en-CA', {
      timeZone: ScannedTrackerCron.NEW_YORK_TIMEZONE,
    });
  }

  private toIsoUtcString(date: Date): string {
    return date.toISOString().slice(0, 19) + 'Z';
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}