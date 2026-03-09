/**
 * CollectorService: main orchestrator for the real-time data collection pipeline.
 *
 * Responsibilities:
 * 1. Manage active symbols (persist in MySQL, keep in memory)
 * 2. Backfill missing 1m candles from MoMo API on late start / restart
 * 3. Process closed 1m candles (compute indicators, upsert MySQL, push WS)
 * 4. Wire Alpaca subscriptions through AlpacaStreamService
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { MysqlTrainingRepository } from '../scanner/mysql/mysql-training.repository';
import { ScannerService, Candle } from '../scanner/scanner.service';
import { MomoStreamService } from './momo-stream.service';
import { CollectorGateway } from './collector.gateway';
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

  constructor(
    private readonly mysqlRepo: MysqlTrainingRepository,
    private readonly scannerService: ScannerService,
    private readonly momoStream: MomoStreamService,
    private readonly gateway: CollectorGateway,
  ) {
    this.momoBase = process.env.MOMO_BASE_URL ?? 'https://momoscreener.com/api/p';
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('CollectorService initializing…');

    // 1. Ensure persistence table exists
    await this.mysqlRepo.ensureCollectorTable();

    // 2. Wire MoMo stream → candle closed callback + live tick callback
    this.momoStream.init(
      (symbol, candle) => this.onCandleClosed(symbol, candle),
      (symbol, candle) => this.onLiveTick(symbol, candle),
    );

    // 3. Load persisted symbols from previous session
    const persisted = await this.mysqlRepo.getActiveSymbols();
    if (persisted.length) {
      this.logger.log(`Restoring ${persisted.length} persisted symbols: ${persisted.map((s) => s.symbol).join(', ')}`);
      for (const { symbol } of persisted) {
        await this.addSymbol(symbol, 'restored', true);
      }
    }

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

    // Subscribe to MoMo real-time live quotes
    this.momoStream.subscribe([symbol]);

    // Notify UI clients
    this.gateway.emitSymbolsUpdate(this.getActiveSymbolList());
  }

  /**
   * Backfill today's 1m candles from MoMo API.
   * Deletes existing data for symbol+date and reinserts cleanly.
   */
  async backfillFromMomo(symbol: string): Promise<void> {
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

    // Delete all existing data for this symbol+date, then insert fresh
    const deleted = await this.mysqlRepo.deleteCandlesForSymbolDate(symbol, todayET);
    if (deleted > 0) {
      this.logger.log(`Deleted ${deleted} old rows for ${symbol} on ${todayET}`);
    }

    for (let i = 0; i < state.history.length; i++) {
      const historySlice = state.history.slice(0, i + 1);
      const row = computeCandleRow(symbol, historySlice, state.metadata);
      await this.mysqlRepo.upsertCandle(row as unknown as Record<string, unknown>);
    }

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
    if (!state) return;

    // Deduplicate: if the last candle in history has the same minute, replace it
    const last = state.history[state.history.length - 1];
    if (last && last.t === candle.t) {
      state.history[state.history.length - 1] = candle;
    } else {
      state.history.push(candle);
    }

    // Compute indicators and build MySQL row
    const row = computeCandleRow(symbol, state.history, state.metadata);

    // Upsert into MySQL
    await this.mysqlRepo.upsertCandle(row as unknown as Record<string, unknown>);

    // Push to UI via WebSocket
    this.gateway.emitCandleUpdate(row);

    this.logger.debug(
      `${symbol} ${row.candle_time_et} | c=${row.close.toFixed(3)} v=${row.volume} ` +
      `vwap=${row.vwap.toFixed(3)} ema9=${row.ema9.toFixed(3)} atr=${row.atr.toFixed(3)}`,
    );
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
  async refreshAllFromMomo(): Promise<void> {
    const symbols = [...this.activeSymbols.keys()];
    if (!symbols.length) return;
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
  }

  /**
   * Get list of actively tracked symbols.
   */
  getActiveSymbolList(): string[] {
    return [...this.activeSymbols.keys()];
  }

  /**
   * Get today's date string in ET timezone.
   */
  private getTodayDateET(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }
}
