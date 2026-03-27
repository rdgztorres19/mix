/**
 * CollectorService: main orchestrator for the real-time data collection pipeline.
 *
 * Responsibilities:
 * 1. Manage active symbols (persist in MySQL, keep in memory)
 * 2. Backfill missing 1m candles from MoMo API on late start / restart
 * 3. Process closed 1m candles (compute indicators, upsert MySQL, push WS)
 * 4. Wire Alpaca subscriptions through AlpacaStreamService
 */

import { Injectable, Logger, OnModuleInit, Inject, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import axios from 'axios';
import { MysqlTrainingRepository } from '../scanner/mysql/mysql-training.repository';
import { AlpacaDataSource } from '../scanner/datasource/alpaca-datasource';
import { ScannerService, Candle } from '../scanner/scanner.service';
import { MomoStreamService } from './momo-stream.service';
import { CollectorGateway } from './collector.gateway';
import { AutoTraderService } from '../trader/auto-trader.service';
import type { WebSocketInitService } from '../websocket/websocket-init.service';
import { buildTrainingRow } from '../training/training-row-builder';
import { computePremarketVolume } from '../training/premarket-volume.feature';
import { FundamentalCacheService } from '../training/fundamental-cache.service';
import type { TrainingCandle } from '../training/types';
import {
  CollectorCandle,
  SymbolMetadata,
  CandleRow,
  computeCandleRow,
  timestampToET,
} from './indicator.calculator';
import {
  TopGainersSourceService,
  type TopGainerSource,
  getTopGainerSourceFromEnv,
} from './top-gainers-source.service';
import { ScannedTrackerService } from './tracker/scanned-tracker.service';

interface SymbolState {
  symbol: string;
  metadata: SymbolMetadata;
  history: CollectorCandle[]; // today's candles in chronological order
}

@Injectable()
export class CollectorService implements OnModuleInit {
  private readonly logger = new Logger(CollectorService.name);
  /** All symbols we collect candle data for (Map for SymbolState) */
  private readonly symbols = new Map<string, SymbolState>();
  /** Subset for trading/prediction only; replaced every minute by cron */
  private readonly activeSymbols = new Set<string>();
  private readonly momoBase: string;
  private webSocketInit?: WebSocketInitService;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly mysqlRepo: MysqlTrainingRepository,
    private readonly alpacaDataSource: AlpacaDataSource,
    private readonly scannerService: ScannerService,
    private readonly momoStream: MomoStreamService,
    private readonly gateway: CollectorGateway,
    private readonly topGainersSource: TopGainersSourceService,
    private readonly scannedTracker: ScannedTrackerService,
    private readonly fundamentalCache: FundamentalCacheService,
    @Optional() @Inject(AutoTraderService) private readonly autoTrader?: AutoTraderService,
  ) {
    this.momoBase = process.env.MOMO_BASE_URL ?? 'https://momoscreener.com/api/p';
    // Inject gateway into autoTrader (avoids circular module dependency)
    if (this.autoTrader) this.autoTrader.setGateway(this.gateway);
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('CollectorService initializing…');

    // Resolve WebSocketInitService lazily via ModuleRef to avoid circular DI issues
    try {
      this.webSocketInit = this.moduleRef.get<WebSocketInitService>('WEB_SOCKET_INIT_SERVICE', {
        strict: false,
      });
      this.logger.log('WebSocketInitService resolved via ModuleRef');
    } catch (err) {
      this.logger.warn('WebSocketInitService not registered in DI container');
    }

    // 1. Ensure persistence table exists
    await this.mysqlRepo.ensureCollectorTable();

    // 2. Wire MoMo stream callbacks but service is DISABLED
    // MoMo is completely disabled - no connection will be established
    this.momoStream.init(
      (symbol, candle) => this.onCandleClosed(symbol, candle),
      (symbol, candle) => this.onLiveTick(symbol, candle),
    );

    // 3. Load persisted symbols from previous session (parallel in batches of 5)
    const persisted = await this.mysqlRepo.getActiveSymbols();

    if (persisted.length) {
      this.logger.log(`Restoring ${persisted.length} persisted symbols: ${persisted.map((s) => s.symbol).join(', ')}`);
      const BATCH = 5;
      for (let i = 0; i < persisted.length; i += BATCH) {
        const batch = persisted.slice(i, i + BATCH);
        await Promise.all(batch.map(({ symbol }) => this.addSymbolToCollection(symbol, 'restored', true)));
      }
    }

    // 4. Wait a moment for WebSocket connections to initialize
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 5. Migrate to Alpaca if available and symbols exist
    await this.migrateToAlpacaIfAvailable();

    this.logger.log(`CollectorService ready — ${this.symbols.size} symbols, ${this.activeSymbols.size} active (trading)`);
  }

  /**
   * Add a new symbol to collection. Fetches from Alpaca, backfills today's candles,
   * subscribes to Alpaca real-time trades. Does NOT add to activeSymbols (trading set).
   */
  async addSymbolToCollection(symbol: string, source = 'cron', skipPersist = false): Promise<void> {
    symbol = symbol.toUpperCase();
    if (this.symbols.has(symbol)) return;

    this.logger.log(`Adding symbol to collection: ${symbol} (source: ${source})`);

    const todayET = this.getTodayDateET();
    const result = await this._syncSymbolDateCore(symbol, todayET);

    if (!result.ok || !result.candles || !result.metadata) {
      this.logger.warn(`addSymbolToCollection: ${symbol} - ${result.error ?? 'no data'}`);
      return;
    }

    const state: SymbolState = {
      symbol,
      metadata: result.metadata,
      history: result.candles,
    };

    this.symbols.set(symbol, state);

    // Notify tracker about the new symbol (only when it truly is new, skipPersist=false means first time)
    if (!skipPersist) {
      await this.mysqlRepo.saveActiveSymbol(symbol, source);
    }

    this.scannedTracker.trackNewSymbol(symbol).catch(e =>
      this.logger.warn(`ScannedTracker error for ${symbol}: ${(e as Error).message}`)
    );

    if (this.webSocketInit?.isAlpacaConnected() && this.webSocketInit) {
      try {
        await this.webSocketInit.refreshSubscriptions(this.getSymbolsList());
        this.logger.log(`✅ ${symbol} subscribed to Alpaca WebSocket`);
      } catch (error) {
        this.logger.warn(`Failed to subscribe ${symbol} to Alpaca: ${(error as Error).message}`);
      }
    }

    this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
  }

  /**
   * Called by CandleBuilder on every trade tick with the current in-progress candle.
   * Pushes live (partial) candle to UI so the user sees it moving.
   */
  private onLiveTick(symbol: string, candle: CollectorCandle): void {
    const state = this.symbols.get(symbol);
    if (!state) return;
    this.gateway.emitCandleLive(symbol, candle);
  }

  /**
   * Called by CandleBuilder when a 1-minute candle closes from Alpaca real-time trades.
   * Only runs prediction (autoTrader) for symbols in activeSymbols (trading set).
   */
  async onCandleClosed(symbol: string, candle: CollectorCandle): Promise<void> {
    const state = this.symbols.get(symbol);
    if (!state) {
      this.logger.warn(`onCandleClosed: No state found for symbol ${symbol}`);
      return;
    }

    this.logger.log(`🕯️  onCandleClosed: ${symbol} at ${new Date(candle.t).toISOString()} close=${candle.c.toFixed(3)}`);

    // Deduplicate: if the last candle in history has the same minute, replace it
    const last = state.history[state.history.length - 1];
    if (last && last.t === candle.t) {
      state.history[state.history.length - 1] = candle;
    } else {
      state.history.push(candle);
    }

    // Compute indicators and build MySQL row
    const row = computeCandleRow(symbol, state.history, state.metadata);

    try {
      // Upsert into MySQL
      await this.mysqlRepo.upsertCandle(row as unknown as Record<string, unknown>);
      this.logger.debug(`✅ MySQL upsert successful: ${symbol} ${row.candle_time_et}`);

      // Push to UI via WebSocket
      this.gateway.emitCandleUpdate(row);
      this.logger.debug(`📡 Emitted to WebSocket gateway: ${symbol} ${row.candle_time_et}`);

      // Auto-predict + auto-trade only for activeSymbols (trading set)
      if (this.autoTrader && this.activeSymbols.has(symbol)) {
        this.autoTrader.onCandleClosed(row).catch((err) =>
          this.logger.warn(`AutoTrader error: ${(err as Error).message}`),
        );
      }

      this.logger.log(
        `${symbol} ${row.candle_time_et} | c=${row.close.toFixed(3)} v=${row.volume} ` +
        `vwap=${row.vwap.toFixed(3)} ema9=${row.ema9.toFixed(3)} atr=${row.atr.toFixed(3)}`,
      );
    } catch (error) {
      this.logger.error(`Error processing candle for ${symbol}: ${(error as Error).message}`);
    }
  }

  /**
   * Clear all symbols and activeSymbols for a fresh trading day.
   */
  async resetActiveSymbols(): Promise<void> {
    const symbolList = this.getSymbolsList();

    if (symbolList.length && this.webSocketInit) {
      try {
        await this.webSocketInit.refreshSubscriptions([]);
        this.logger.log(`🚫 Cleared all Alpaca WebSocket subscriptions`);
      } catch (error) {
        this.logger.warn(`Failed to clear Alpaca WebSocket subscriptions: ${(error as Error).message}`);
      }
    }

    this.symbols.clear();
    this.activeSymbols.clear();
    await this.mysqlRepo.deactivateAllSymbols();
    this.gateway.emitSymbolsUpdate([]);

    this.logger.log('🔄 Symbols and activeSymbols cleared');
  }

  /**
   * Cron: fetch top gainers from env source, replace activeSymbols, add new to symbols.
   */
  async runTopGainersCron(): Promise<void> {
    const source = getTopGainerSourceFromEnv();
    const fetched = await this.topGainersSource.fetchSymbols(source);
    if (!fetched.length) {
      this.logger.debug('Top gainers cron: no symbols from source');
      return;
    }

    this.logger.log(`Top gainers cron (${source}): ${fetched.length} symbols`);

    // Replace activeSymbols completely
    this.activeSymbols.clear();
    for (const s of fetched) this.activeSymbols.add(s.toUpperCase());

    // Add new symbols to collection (Alpaca backfill) - only those not yet in symbols
    const toAdd = fetched.filter((s) => !this.symbols.has(s.toUpperCase()));

    for (const symbol of toAdd) {
      try {
        await this.addSymbolToCollection(symbol, `cron_${source}`, false);
      } catch (err) {
        this.logger.warn(`Cron add ${symbol} failed: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    if (this.webSocketInit) {
      try {
        await this.webSocketInit.refreshSubscriptions(this.getSymbolsList());
      } catch (err) {
        this.logger.warn(`Cron refresh subscriptions failed: ${(err as Error).message}`);
      }
    }

    await this.mysqlRepo.deactivateAllSymbols();

    for (const s of this.activeSymbols) {
      await this.mysqlRepo.saveActiveSymbol(s, `cron_${source}`);
    }

    this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
  }

  /** @deprecated Use runTopGainersCron. Kept for backward compatibility. */
  async scanMomo(): Promise<string[]> {
    this.logger.warn('scanMomo is deprecated, use runTopGainersCron');
    await this.runTopGainersCron();
    return this.getActiveSymbolList();
  }

  /** @deprecated MoMo refresh no longer used. */
  async refreshAllFromMomo(): Promise<{ skipped: boolean; reason?: string }> {
    this.logger.warn('refreshAllFromMomo is deprecated');
    return { skipped: true, reason: 'deprecated' };
  }

  /**
   * Setup Alpaca WebSocket subscriptions for all collected symbols.
   */
  async migrateToAlpacaIfAvailable(): Promise<void> {
    if (!this.webSocketInit) {
      this.logger.warn('WebSocketInitService not available - using 61s historical fallback only');
      return;
    }

    const alpacaConnected = this.webSocketInit.isAlpacaConnected();
    const symbolList = this.getSymbolsList();

    if (alpacaConnected && symbolList.length > 0) {
      this.logger.log(`🔄 Setting up ${symbolList.length} symbols on Alpaca WebSocket...`);

      try {
        await this.webSocketInit.refreshSubscriptions(symbolList);
        this.logger.log(`✅ ${symbolList.length} symbols active on Alpaca WebSocket`);
      } catch (error) {
        this.logger.error(`❌ Failed to setup Alpaca: ${(error as Error).message}`);
        this.logger.warn(`Relying on 61s historical fallback only`);
      }
    } else if (symbolList.length > 0) {
      this.logger.warn(`⚠️ Alpaca WebSocket not available for ${symbolList.length} symbols - 61s historical fallback only`);
    }
  }

  /**
   * Get list of symbols we collect candle data for (for Alpaca subscription).
   */
  getSymbolsList(): string[] {
    return [...this.symbols.keys()];
  }

  /**
   * Get list of actively traded symbols (for prediction/trading only).
   */
  getActiveSymbolList(): string[] {
    return [...this.symbols.keys()];
    //return [...this.activeSymbols];
  }

  /**
   * Debug: get status of symbols and activeSymbols.
   */
  getDebugStatus(): {
    activeSymbols: string[];
    subscribedSymbols: string[];
    symbols: string[];
    wsConnected: boolean;
    symbolCount: number;
  } {
    const symbolList = this.getSymbolsList();
    return {
      activeSymbols: this.getActiveSymbolList(),
      subscribedSymbols: symbolList,
      symbols: symbolList,
      wsConnected: this.webSocketInit?.isAlpacaConnected() ?? false,
      symbolCount: this.symbols.size,
    };
  }

  /**
   * Reload any symbols from DB that are missing from in-memory map.
   * Called when Alpaca reconnects to pick up symbols added while disconnected.
   */
  async reloadMissingSymbolsFromDb(): Promise<number> {
    const persisted = await this.mysqlRepo.getActiveSymbols();
    const toAdd = persisted.filter((s) => !this.symbols.has(s.symbol));
    for (const { symbol } of toAdd) {
      await this.addSymbolToCollection(symbol, 'restored', true);
    }
    if (toAdd.length > 0) {
      this.logger.log(`📥 Reloaded ${toAdd.length} missing symbols from DB: ${toAdd.map((s) => s.symbol).join(', ')}`);
    }
    return toAdd.length;
  }

  /**
   * Debug: force re-subscription to Alpaca WebSocket only.
   */
  async forceResubscribeAll(): Promise<{ ok: boolean; resubscribed: string[] }> {
    await this.reloadMissingSymbolsFromDb();
    const symbolList = this.getSymbolsList();
    this.logger.log(`Force re-subscribing to ${symbolList.length} symbols on Alpaca: ${symbolList.join(', ')}`);

    if (symbolList.length > 0 && this.webSocketInit) {
      try {
        await this.webSocketInit.refreshSubscriptions(symbolList);
        this.logger.log(`✅ Re-subscribed ${symbolList.length} symbols to Alpaca`);
      } catch (error) {
        this.logger.error(`❌ Failed to re-subscribe to Alpaca: ${(error as Error).message}`);
        return { ok: false, resubscribed: [] };
      }
    }

    return { ok: true, resubscribed: symbolList };
  }

  /**
   * Debug: reset WebSocket statistics counters.
   */
  resetWebSocketStats(): void {
    this.momoStream.resetStats();
    this.logger.log('WebSocket statistics reset');
  }

  /**
   * Debug: get WebSocket stream statistics.
   */
  getWebSocketStats() {
    return this.momoStream.getStats();
  }

  /**
   * Get today's date string in ET timezone.
   */
  private getTodayDateET(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }

  private getMinuteOfDayET(): number {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
    const h = parseInt(get('hour'), 10);
    const m = parseInt(get('minute'), 10);
    return h * 60 + m;
  }

  private isAfterHoursNow(): boolean {
    return this.getMinuteOfDayET() >= 16 * 60;
  }

  /**
   * Core sync: fetch from Alpaca, build rows, insert. Returns candles and metadata for state.
   */
  private async _syncSymbolDateCore(
    symbol: string,
    dateStr: string,
  ): Promise<{
    ok: boolean;
    rows: number;
    error?: string;
    candles?: CollectorCandle[];
    metadata?: SymbolMetadata;
  }> {
    symbol = symbol.toUpperCase();
    const candles = await this.alpacaDataSource.fetch1mBarsForDate(symbol, dateStr);
    if (!candles.length) {
      return { ok: false, rows: 0, error: 'no_data' };
    }

    const trainingCandles: TrainingCandle[] = candles.map((c) => ({ ...c }));

    const prevDate = this.prevTradingDay(dateStr);
    let priorClose = 0;
    try {
      const prevBars = await this.alpacaDataSource.fetch1mBarsForDate(symbol, prevDate);
      if (prevBars.length) {
        priorClose = prevBars[prevBars.length - 1].c;
      }
    } catch {
      priorClose = trainingCandles[0]?.o ?? trainingCandles[0]?.c ?? 0;
    }
    if (priorClose <= 0) {
      priorClose = trainingCandles[0]?.o ?? trainingCandles[0]?.c ?? 0;
    }

    const openDay = trainingCandles[0].o;
    const firstRegular = trainingCandles.find((c) => {
      const { minuteOfDay } = timestampToET(c.t);
      return minuteOfDay >= 9 * 60 + 30;
    });
    const openFirst = firstRegular?.o ?? openDay;

    const premarketVolume = computePremarketVolume(trainingCandles);

    const preMarketCandles = trainingCandles.filter((c) => {
      const { minuteOfDay } = timestampToET(c.t);
      return minuteOfDay < 9 * 60 + 30;
    });
    const preMarketHigh = preMarketCandles.length
      ? Math.max(...preMarketCandles.map((c) => c.h))
      : null;

    const fundamentals = await this.fundamentalCache.getFundamentals(symbol);
    const metadata: SymbolMetadata = {
      priorClose,
      preMarketHigh: preMarketHigh ?? 0,
      sharesOutstanding: fundamentals.sharesOutstanding ?? null,
      marketCap: fundamentals.marketCap ?? null,
      gapPct: priorClose > 0 ? (openFirst - priorClose) / priorClose : 0,
      premarketVolume,
    };

    await this.mysqlRepo.deleteCandlesForSymbolDate(symbol, dateStr);

    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < trainingCandles.length; i++) {
      const row = buildTrainingRow({
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
      });
      rows.push(row as unknown as Record<string, unknown>);
    }

    await this.mysqlRepo.bulkUpsertCandles(rows);

    const collectorCandles: CollectorCandle[] = trainingCandles.map((c) => ({
      o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, t: c.t,
    }));

    return { ok: true, rows: rows.length, candles: collectorCandles, metadata };
  }

  /**
   * Sync symbol+date from Alpaca: fetch 1m bars, delete existing rows,
   * build training rows with unified features, bulk insert.
   * POST /collector/sync-symbol-date with body { symbol, date }.
   */
  async syncSymbolDate(symbol: string, dateStr: string): Promise<{ ok: boolean; rows: number; error?: string }> {
    symbol = symbol.toUpperCase();
    try {
      this.logger.log(`syncSymbolDate: ${symbol} ${dateStr}`);
      const result = await this._syncSymbolDateCore(symbol, dateStr);
      if (result.ok) {
        this.logger.log(`syncSymbolDate: ${symbol} ${dateStr} inserted ${result.rows} rows`);
      }
      return { ok: result.ok, rows: result.rows, error: result.error };
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`syncSymbolDate failed for ${symbol} ${dateStr}: ${msg}`);
      return { ok: false, rows: 0, error: msg };
    }
  }

  /**
   * Sync today: fetch top gainers from env source (internal screener, HPG, or Alpaca), then sync each from Alpaca.
   * Replaces refreshAllFromMomo for the sync-today flow.
   */
  async syncTodayFromSource(source: TopGainerSource): Promise<{
    ok: boolean;
    symbols: number;
    totalRows: number;
    skipped?: boolean;
    reason?: string;
  }> {
    // if (this.isAfterHoursNow()) {
    //   this.logger.log('Sync today skipped (after hours)');
    //   return { ok: false, symbols: 0, totalRows: 0, skipped: true, reason: 'after_hours' };
    // }

    const symbols = await this.topGainersSource.fetchSymbols(source);
    if (!symbols.length) {
      this.logger.warn('Sync today: no symbols from source');
      return { ok: false, symbols: 0, totalRows: 0, skipped: true, reason: 'no_symbols' };
    }

    this.logger.log(`Sync today from ${source}: ${symbols.length} symbols`);

    const todayET = this.getTodayDateET();
    const deleted = await this.mysqlRepo.deleteCandlesForDate(todayET);
    if (deleted > 0) {
      this.logger.log(`Cleared ${deleted} existing rows for today before sync`);
    }

    await this.resetActiveSymbols();
    let totalRows = 0;

    for (const symbol of symbols) {
      const sym = symbol.toUpperCase();
      try {
        const result = await this._syncSymbolDateCore(sym, todayET);
        if (result.ok && result.candles && result.metadata) {
          totalRows += result.rows;

          const state: SymbolState = {
            symbol: sym,
            metadata: result.metadata,
            history: result.candles,
          };
          this.symbols.set(sym, state);
          this.activeSymbols.add(sym);
          await this.mysqlRepo.saveActiveSymbol(sym, `sync_${source}`);
        } else if (result.error) {
          this.logger.warn(`Sync today: ${sym} - ${result.error}`);
        }
      } catch (err) {
        this.logger.warn(`Sync today failed for ${sym}: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    if (this.symbols.size > 0 && this.webSocketInit) {
      try {
        await this.webSocketInit.refreshSubscriptions(this.getSymbolsList());
        this.logger.log(`✅ Subscribed ${this.symbols.size} symbols to Alpaca WebSocket`);
      } catch (err) {
        this.logger.warn(`Failed to subscribe to Alpaca: ${(err as Error).message}`);
      }
    }

    this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
    this.logger.log(`Sync today complete: ${this.activeSymbols.size} active, ${totalRows} rows`);
    return { ok: true, symbols: this.activeSymbols.size, totalRows };
  }

  /**
   * Sync ALL symbols that exist in DB for the given date.
   * For each symbol: fetch from Alpaca, delete existing, rebuild with unified features, bulk insert.
   */
  async syncDate(dateStr: string): Promise<{
    ok: boolean;
    symbols: number;
    totalRows: number;
    errors: string[];
  }> {
    const symbols = await this.mysqlRepo.getSymbolsForDate(dateStr);
    if (!symbols.length) {
      this.logger.warn(`syncDate: no symbols found in DB for ${dateStr}`);
      return { ok: false, symbols: 0, totalRows: 0, errors: ['no symbols in DB for this date'] };
    }

    this.logger.log(`syncDate: syncing ${symbols.length} symbols for ${dateStr}`);
    const errors: string[] = [];
    let totalRows = 0;

    for (const symbol of symbols) {
      try {
        const result = await this.syncSymbolDate(symbol, dateStr);
        if (result.ok) {
          totalRows += result.rows;
        } else if (result.error) {
          errors.push(`${symbol}: ${result.error}`);
        }
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`${symbol}: ${msg}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    const ok = errors.length === 0;
    this.logger.log(`syncDate: ${dateStr} done — ${symbols.length} symbols, ${totalRows} rows${errors.length ? `, ${errors.length} errors` : ''}`);
    return { ok, symbols: symbols.length, totalRows, errors };
  }

  private prevTradingDay(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay();
    if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);
    else if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
}
