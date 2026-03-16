import { Injectable, Logger } from '@nestjs/common';
import { MysqlTrainingRepository } from '../../scanner/mysql/mysql-training.repository';
import axios from 'axios';
import { scoreHeadlines, fetchYahooNews, fetchFinvizNews } from '../../agent/tools/news.tool';

export interface ScannedSymbolData {
  symbol: string;
  passes_pre_filter: boolean;
  float_shares: number | null;
  outstanding_shares: number | null;
  free_float: number | null;
  catalyst_strength: string | null;
  catalyst_type: string | null;
  premarket_volume: number | null;
  premarket_dollar_volume: number | null;
  volume: number | null;
  dollar_volume: number | null;
  close: number | null;
  ema9: number | null;
  gap_pct: number | null;
  arrived_at: Date;
  updated_at: Date;
}

@Injectable()
export class ScannedTrackerService {
  private readonly logger = new Logger(ScannedTrackerService.name);
  
  // In-memory cache for today's tracked symbols
  private trackedSymbols: Map<string, ScannedSymbolData> = new Map();

  constructor(
    private readonly mysqlRepo: MysqlTrainingRepository,
  ) {}

  async onModuleInit() {
    await this.mysqlRepo.ensureTrackerTable();
    await this.loadTodayTrackedSymbolsFromDb();
  }

  private async loadTodayTrackedSymbolsFromDb() {
    try {
      const rows = await this.mysqlRepo.getScannedSymbolsForToday();
      for (const row of rows as any[]) {
        this.trackedSymbols.set(row.symbol, {
          symbol: row.symbol,
          passes_pre_filter: row.passes_pre_filter === 1,
          float_shares: row.float_shares,
          outstanding_shares: row.outstanding_shares,
          free_float: row.free_float,
          catalyst_strength: row.catalyst_strength,
          catalyst_type: row.catalyst_type,
          premarket_volume: row.premarket_volume,
          premarket_dollar_volume: row.premarket_dollar_volume,
          volume: row.volume,
          dollar_volume: row.dollar_volume,
          close: row.close,
          ema9: row.ema9,
          gap_pct: row.gap_pct,
          arrived_at: new Date(row.arrived_at),
          updated_at: new Date(row.updated_at),
        });
      }
      this.logger.log(`Loaded ${this.trackedSymbols.size} tracked symbols from DB for today.`);
    } catch (err) {
      this.logger.error(`Failed to load tracked symbols on init: ${err.message}`);
    }
  }

  getTrackedSymbols(): ScannedSymbolData[] {
    // Return array sorted by arrived_at desc
    return Array.from(this.trackedSymbols.values()).sort((a, b) => b.arrived_at.getTime() - a.arrived_at.getTime());
  }

  /**
   * Invoked when the scanner identifies a new symbol
   */
  async trackNewSymbol(symbol: string) {
    if (this.trackedSymbols.has(symbol)) {
      return; // Already tracking today
    }

    const now = new Date();
    const newData: ScannedSymbolData = {
      symbol,
      passes_pre_filter: false, // Calculated later via cron
      float_shares: null,       // Fetched once via FMP
      outstanding_shares: null, // Fetched once via FMP
      free_float: null,         // Fetched once via FMP
      catalyst_strength: null,  // Fetched once via News
      catalyst_type: null,
      premarket_volume: null,
      premarket_dollar_volume: null,
      volume: null,
      dollar_volume: null,
      close: null,
      ema9: null,
      gap_pct: null,
      arrived_at: now,
      updated_at: now,
    };

    this.trackedSymbols.set(symbol, newData);
    
    // Attempt to fetch float immediately since it only needs to happen once
    await this.fetchFloatData(newData);
    
    // Attempt to fetch news catalyst immediately
    await this.fetchNewsData(newData);

    // Save initial state to DB
    await this.mysqlRepo.upsertScannedSymbol(newData);
    this.logger.log(`Started tracking new symbol from scanner: ${symbol}`);
  }

  private async fetchFloatData(data: ScannedSymbolData) {
    const fmpKey = process.env.FMP_API_KEY;
    if (!fmpKey) {
      this.logger.warn(`No FMP_API_KEY found, skipping float fetch for ${data.symbol}`);
      return;
    }

    try {
      const url = `https://financialmodelingprep.com/stable/shares-float?symbol=${data.symbol}&apikey=${fmpKey}`;
      const res = await axios.get(url, { timeout: 8000 });
      if (res.data && Array.isArray(res.data) && res.data.length > 0) {
        const info = res.data[0];
        data.float_shares = info.floatShares || null;
        data.outstanding_shares = info.outstandingShares || null;
        data.free_float = info.freeFloat || null;
        this.logger.log(`Fetched float for ${data.symbol}: ${data.free_float}% free float`);
      }
    } catch (err) {
      this.logger.error(`Failed to fetch float for ${data.symbol}: ${err.message}`);
    }
  }

  private async fetchNewsData(data: ScannedSymbolData) {
    try {
      let headlines = await fetchYahooNews(data.symbol);
      if (!headlines.length) {
        headlines = await fetchFinvizNews(data.symbol);
      }
      
      const { strength, catalyst_type } = await scoreHeadlines(headlines);
      data.catalyst_strength = strength;
      data.catalyst_type = catalyst_type;
      this.logger.log(`Fetched news catalyst for ${data.symbol}: ${strength} - ${catalyst_type}`);
    } catch (err) {
      this.logger.error(`Failed to fetch news for ${data.symbol}: ${err.message}`);
    }
  }

  /**
   * Updates tracking calculations (premarket/volume/ema9 etc)
   * This is called by the Cron job every 1 min
   */
  async updateCalculatedMetrics(
    symbol: string, 
    metrics: {
      premarket_volume: number | null;
      premarket_dollar_volume: number | null;
      volume: number | null;
      dollar_volume: number | null;
      close: number | null;
      ema9: number | null;
      gap_pct: number | null;
      passes_pre_filter: boolean;
    }
  ) {
    const tracked = this.trackedSymbols.get(symbol);
    if (!tracked) return;

    tracked.premarket_volume = metrics.premarket_volume;
    tracked.premarket_dollar_volume = metrics.premarket_dollar_volume;
    tracked.volume = metrics.volume;
    tracked.dollar_volume = metrics.dollar_volume;
    tracked.close = metrics.close;
    tracked.ema9 = metrics.ema9;
    tracked.gap_pct = metrics.gap_pct;
    tracked.passes_pre_filter = metrics.passes_pre_filter;
    tracked.updated_at = new Date();

    // Persist to DB
    await this.mysqlRepo.upsertScannedSymbol(tracked);
  }
}
