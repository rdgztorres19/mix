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
import { ScannerService, Candle } from '../scanner/scanner.service';
import { MomoStreamService } from './momo-stream.service';
import { CollectorGateway } from './collector.gateway';
import { AutoTraderService } from '../trader/auto-trader.service';
import type { WebSocketInitService } from '../websocket/websocket-init.service';
import {
  CollectorCandle,
  SymbolMetadata,
  CandleRow,
  computeCandleRow,
  timestampToET,
} from './indicator.calculator';

interface SymbolState {
  symbol: string;
  metadata: SymbolMetadata;
  history: CollectorCandle[]; // today's candles in chronological order
}

@Injectable()
export class CollectorService implements OnModuleInit {
  private readonly logger = new Logger(CollectorService.name);
  private readonly activeSymbols = new Map<string, SymbolState>();
  private readonly momoBase: string;
  private webSocketInit?: WebSocketInitService;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly mysqlRepo: MysqlTrainingRepository,
    private readonly scannerService: ScannerService,
    private readonly momoStream: MomoStreamService,
    private readonly gateway: CollectorGateway,
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
    this.logger.log('🚫 MoMo stream service is DISABLED - Alpaca WebSocket + 61s fallback only');

    // 3. Load persisted symbols from previous session (parallel in batches of 5)
    const persisted = await this.mysqlRepo.getActiveSymbols();
    if (persisted.length) {
      this.logger.log(`Restoring ${persisted.length} persisted symbols: ${persisted.map((s) => s.symbol).join(', ')}`);
      const BATCH = 5;
      for (let i = 0; i < persisted.length; i += BATCH) {
        const batch = persisted.slice(i, i + BATCH);
        await Promise.all(batch.map(({ symbol }) => this.addSymbol(symbol, 'restored', true)));
      }
    }

    // 4. Wait a moment for WebSocket connections to initialize
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 5. Migrate to Alpaca if available and symbols exist
    await this.migrateToAlpacaIfAvailable();

    this.logger.log(`CollectorService ready — ${this.activeSymbols.size} active symbols`);
  }

  /**
   * Add a new symbol to track. Fetches metadata, backfills today's candles,
   * subscribes to Alpaca real-time trades.
   */
  async addSymbol(symbol: string, source = 'momo', skipPersist = false): Promise<void> {
    symbol = symbol.toUpperCase();
    if (this.activeSymbols.has(symbol)) return;

    this.logger.log(`Adding symbol: ${symbol} (source: ${source})`);

    // Fetch metadata from momo snapshot
    let metadata: SymbolMetadata = {
      priorClose: 0,
      preMarketHigh: 0,
      sharesOutstanding: 0,
      marketCap: 0,
      gapPct: 0,
      premarketVolume: 0,
    };

    try {
      const snap = await this.scannerService.getStockSnapshotFromMomo(symbol, undefined, '1m');
      const priorCandles = snap.candles_1min;
      const lastClose = priorCandles.length ? priorCandles[priorCandles.length - 1].c : snap.price;

      metadata = {
        priorClose: lastClose - lastClose * snap.change_pct, // approximate prior close
        preMarketHigh: snap.pre_market_high ?? 0,
        sharesOutstanding: 0, // not available from momo
        marketCap: 0,
        gapPct: snap.change_pct,
        premarketVolume: 0,
      };
    } catch (err) {
      this.logger.warn(`Failed to fetch metadata for ${symbol}: ${(err as Error).message}`);
    }

    const state: SymbolState = {
      symbol,
      metadata,
      history: [],
    };
    this.activeSymbols.set(symbol, state);

    // Persist symbol
    if (!skipPersist) {
      await this.mysqlRepo.saveActiveSymbol(symbol, source);
    }

    // Backfill today's candles
    await this.backfillFromMomo(symbol);

    // Subscribe to Alpaca WebSocket (primary and only real-time source)
    const alpacaConnected = this.webSocketInit?.isAlpacaConnected() ?? false;
    
    if (alpacaConnected && this.webSocketInit) {
      try {
        const activeSymbols = this.getActiveSymbolList();
        await this.webSocketInit.refreshSubscriptions(activeSymbols);
        this.logger.log(`✅ ${symbol} subscribed to Alpaca WebSocket (premium)`);
      } catch (error) {
        this.logger.warn(`Failed to subscribe ${symbol} to Alpaca: ${(error as Error).message}`);
        this.logger.warn(`Relying on 61s historical fallback only`);
      }
    } else {
      this.logger.warn(`⚠️ Alpaca WebSocket not available for ${symbol} - relying on 61s historical fallback`);
    }

    // Notify UI clients
    this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
  }

  /**
   * Backfill today's 1m candles from MoMo API.
   * Deletes existing data for symbol+date and reinserts cleanly.
   */
  async backfillFromMomo(symbol: string): Promise<void> {
    if (this.isAfterHoursNow()) {
      this.logger.log(`Backfill skipped (after hours): ${symbol}`);
      return;
    }
    const state = this.activeSymbols.get(symbol);
    if (!state) return;

    const todayET = this.getTodayDateET();

    this.logger.log(`Backfilling ${symbol} for ${todayET}`);

    // Fetch 1m candles from MoMo
    let allCandles: Candle[] = [];
    try {
      const url = `${this.momoBase}/ticker/chart?q=${symbol}&interval=1m`;
      const res = await axios.get(url, { timeout: 10000 });
      if (res.data?.error !== 0 || !res.data?.message?.history) {
        this.logger.warn(`MoMo returned no data for ${symbol}`);
        return;
      }
      const raw: [number, number, number, number, number, number][] = res.data.message.history;
      allCandles = raw.slice().reverse().map(([o, h, l, c, v, t]) => ({ o, h, l, c, v, t }));
    } catch (err) {
      this.logger.warn(`MoMo fetch failed for ${symbol}: ${(err as Error).message}`);
      return;
    }

    // Filter to today only
    const todayCandles = allCandles.filter((c) => {
      const { date } = timestampToET(c.t);
      return date === todayET;
    });

    if (!todayCandles.length) {
      this.logger.log(`No candles for ${symbol} today`);
      return;
    }

    // Build history from today's candles
    state.history = todayCandles.map((c) => ({
      o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, t: c.t,
    }));

    // Delete all existing data for this symbol+date, then bulk-insert fresh
    const deleted = await this.mysqlRepo.deleteCandlesForSymbolDate(symbol, todayET);
    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} old rows for ${symbol} on ${todayET}`);
    }

    const allRows: Record<string, unknown>[] = [];
    for (let i = 0; i < state.history.length; i++) {
      const historySlice = state.history.slice(0, i + 1);
      allRows.push(computeCandleRow(symbol, historySlice, state.metadata) as unknown as Record<string, unknown>);
    }
    await this.mysqlRepo.bulkUpsertCandles(allRows);

    this.logger.log(
      `Backfilled ${symbol}: ${todayCandles.length} candles inserted clean`,
    );
  }

  /**
   * Called by CandleBuilder on every trade tick with the current in-progress candle.
   * Pushes live (partial) candle to UI so the user sees it moving.
   */
  private onLiveTick(symbol: string, candle: CollectorCandle): void {
    const state = this.activeSymbols.get(symbol);
    if (!state) return;
    this.gateway.emitCandleLive(symbol, candle);
  }

  /**
   * Called by CandleBuilder when a 1-minute candle closes from Alpaca real-time trades.
   */
  async onCandleClosed(symbol: string, candle: CollectorCandle): Promise<void> {
    const state = this.activeSymbols.get(symbol);
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

      // Auto-predict + auto-trade (fire-and-forget, don't block candle pipeline)
      if (this.autoTrader) {
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
   * Clear active symbols for a fresh trading day.
   */
  async resetActiveSymbols(): Promise<void> {
    const symbols = [...this.activeSymbols.keys()];
    
    // Clear Alpaca WebSocket subscriptions only (MoMo is disabled)
    if (symbols.length && this.webSocketInit) {
      try {
        await this.webSocketInit.refreshSubscriptions([]); // Empty array clears all
        this.logger.log(`🚫 Cleared all Alpaca WebSocket subscriptions`);
      } catch (error) {
        this.logger.warn(`Failed to clear Alpaca WebSocket subscriptions: ${(error as Error).message}`);
      }
    }
    
    this.activeSymbols.clear();
    await this.mysqlRepo.deactivateAllSymbols();
    this.gateway.emitSymbolsUpdate([]);
    
    this.logger.log('🔄 Active symbols cleared for new trading day');
  }

  /**
   * Scan MoMo for hot tickers and add any new ones.
   */
  async scanMomo(): Promise<string[]> {
    this.logger.log('Scanning MoMo for hot tickers…');
    const url = `https://momoscreener.com/api/momo?int=5&change=3`;
    let items: any[] = [];
    try {
      const res = await axios.get(url, { timeout: 10000 });
      items = res.data?.message ?? [];
    } catch (err) {
      this.logger.warn(`MoMo scan failed: ${(err as Error).message}`);
      return [];
    }

    // Deduplicate by symbol
    const seen = new Set<string>();
    const newSymbols: string[] = [];

    for (const item of items) {
      const sym = (item.symbol || '').toUpperCase();
      if (!sym || seen.has(sym)) continue;
      seen.add(sym);

      // Apply basic filters
      const price = item.live?.lastPrice ?? item.stats?.price ?? 0;
      const change = item.change ?? 0;
      if (price < 2 || price > 20) continue;
      if (change < 3) continue;

      if (!this.activeSymbols.has(sym)) {
        newSymbols.push(sym);
      }
    }

    // Add new symbols
    for (const sym of newSymbols) {
      await this.addSymbol(sym, 'momo_scan');
      // Small delay between API calls
      await new Promise((r) => setTimeout(r, 500));
    }

    if (newSymbols.length) {
      this.logger.log(`MoMo scan added ${newSymbols.length} new symbols: ${newSymbols.join(', ')}`);
    } else {
      this.logger.log(`MoMo scan: no new symbols (${this.activeSymbols.size} active)`);
    }

    return newSymbols;
  }

  /**
   * Periodic refresh: fetch latest candles from MoMo for all active symbols
   * and upsert only candles newer than what we already have.
   * This fills gaps left by Alpaca IEX's limited coverage.
   */
  async refreshAllFromMomo(options: { force?: boolean } = {}): Promise<{ skipped: boolean; reason?: string }> {
    if (!options.force && this.isAfterHoursNow()) {
      this.logger.log('MoMo refresh skipped (after hours)');
      return { skipped: true, reason: 'after_hours' };
    }
    const symbols = [...this.activeSymbols.keys()];
    if (!symbols.length) return { skipped: true, reason: 'no_active_symbols' };
    this.logger.log(`MoMo refresh: updating ${symbols.length} symbols…`);
    const todayET = this.getTodayDateET();

    for (const symbol of symbols) {
      const state = this.activeSymbols.get(symbol);
      if (!state) continue;

      try {
        const url = `${this.momoBase}/ticker/chart?q=${symbol}&interval=1m`;
        const res = await axios.get(url, { timeout: 10000 });
        if (res.data?.error !== 0 || !res.data?.message?.history) continue;

        const raw: [number, number, number, number, number, number][] = res.data.message.history;
        const allCandles = raw.slice().reverse().map(([o, h, l, c, v, t]) => ({ o, h, l, c, v, t }));

        const todayCandles = allCandles.filter((c) => {
          const { date, minuteOfDay } = timestampToET(c.t);
          return date === todayET && minuteOfDay >= 570 && minuteOfDay < 960;
        });

        if (!todayCandles.length) continue;

        // Replace history with MoMo's more complete data
        state.history = todayCandles.map((c) => ({
          o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, t: c.t,
        }));

        // Upsert all candles (ON DUPLICATE KEY UPDATE handles existing ones)
        let newCount = 0;
        for (let i = 0; i < state.history.length; i++) {
          const historySlice = state.history.slice(0, i + 1);
          const row = computeCandleRow(symbol, historySlice, state.metadata);
          await this.mysqlRepo.upsertCandle(row as unknown as Record<string, unknown>);
          newCount++;
        }

        this.logger.debug(`MoMo refresh ${symbol}: ${newCount} candles upserted`);
      } catch (err) {
        this.logger.warn(`MoMo refresh failed for ${symbol}: ${(err as Error).message}`);
      }

      // Small delay between symbols to avoid hammering MoMo
      await new Promise((r) => setTimeout(r, 500));
    }

    this.logger.log(`MoMo refresh complete for ${symbols.length} symbols`);
    return { skipped: false };
  }

  /**
   * Setup Alpaca WebSocket subscriptions (MoMo completely disabled).
   */
  async migrateToAlpacaIfAvailable(): Promise<void> {
    if (!this.webSocketInit) {
      this.logger.warn('WebSocketInitService not available - using 61s historical fallback only');
      return;
    }

    const alpacaConnected = this.webSocketInit.isAlpacaConnected();
    const activeSymbols = this.getActiveSymbolList();

    if (alpacaConnected && activeSymbols.length > 0) {
      this.logger.log(`🔄 Setting up ${activeSymbols.length} symbols on Alpaca WebSocket...`);
      
      try {
        await this.webSocketInit.refreshSubscriptions(activeSymbols);
        this.logger.log(`✅ ${activeSymbols.length} symbols active on Alpaca WebSocket`);
      } catch (error) {
        this.logger.error(`❌ Failed to setup Alpaca: ${(error as Error).message}`);
        this.logger.warn(`Relying on 61s historical fallback only`);
      }
    } else if (activeSymbols.length > 0) {
      this.logger.warn(`⚠️ Alpaca WebSocket not available for ${activeSymbols.length} symbols - 61s historical fallback only`);
    }
  }

  /**
   * Get list of actively tracked symbols.
   */
  getActiveSymbolList(): string[] {
    return [...this.activeSymbols.keys()];
  }

  /**
   * Debug: get status of active symbols (MoMo disabled).
   */
  getDebugStatus(): {
    activeSymbols: string[];
    subscribedSymbols: string[]; // Always empty since MoMo is disabled
    wsConnected: boolean; // Always false since MoMo is disabled
    symbolCount: number;
  } {
    return {
      activeSymbols: this.getActiveSymbolList(),
      subscribedSymbols: [], // MoMo disabled, always empty
      wsConnected: false, // MoMo disabled, always false
      symbolCount: this.activeSymbols.size,
    };
  }

  /**
   * Debug: force re-subscription to Alpaca WebSocket only.
   */
  async forceResubscribeAll(): Promise<{ ok: boolean; resubscribed: string[] }> {
    const symbols = this.getActiveSymbolList();
    this.logger.log(`Force re-subscribing to ${symbols.length} symbols on Alpaca only: ${symbols.join(', ')}`);
    
    if (symbols.length > 0 && this.webSocketInit) {
      try {
        await this.webSocketInit.refreshSubscriptions(symbols);
        this.logger.log(`✅ Re-subscribed ${symbols.length} symbols to Alpaca`);
      } catch (error) {
        this.logger.error(`❌ Failed to re-subscribe to Alpaca: ${(error as Error).message}`);
        return { ok: false, resubscribed: [] };
      }
    }
    
    return { ok: true, resubscribed: symbols };
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
}
