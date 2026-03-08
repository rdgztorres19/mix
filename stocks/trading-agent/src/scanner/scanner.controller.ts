import { Controller, Get, Param, Query, Logger } from '@nestjs/common';
import axios from 'axios';
import { ScannerService, StockCandidate, StockSnapshot } from './scanner.service';
import { StockDataSourceFactory } from './datasource/datasource.factory';
import { MysqlTrainingRepository } from './mysql/mysql-training.repository';
import { applyTradingRules, type PatternPoint, type StrategyGuidance } from '../small-cap-trading';
import { getSession } from '../agent/tools/scanner.tool';

/** Snapshot extended with real-time strategy detection from trading rules engine. */
export interface StockSnapshotWithStrategy extends StockSnapshot {
  strategy: {
    name: string | null;
    viable: boolean;
    entry: number | null;
    stop: number | null;
    target_1: number | null;
    target_2: number | null;
    pattern_signals: string[];
    pattern_points: PatternPoint[];
    strategy_guidance: StrategyGuidance | null;
  };
}

export interface MomoStock {
  symbol: string;
  price: number;
  change: number;
  change5m: number;
  volume: number;
  float: number | null;
  headline: string;
  headline_source: string;
  ideal: boolean; // meets Stock in Play conditions
}
import {
  fetchYahooNews,
  fetchFinvizNews,
  scoreHeadlines,
  NewsItem,
  CatalystAnalysis,
} from '../agent/tools/news.tool';

@Controller('scanner')
export class ScannerController {
  private readonly logger = new Logger(ScannerController.name);

  constructor(
    private readonly scannerService: ScannerService,
    private readonly dataSourceFactory: StockDataSourceFactory,
    private readonly mysqlRepo: MysqlTrainingRepository,
  ) {}

  /**
   * GET /scanner/watchlist
   * Returns today's pre-market gappers filtered by trading criteria.
   */
  @Get('watchlist')
  async getWatchlist(): Promise<{
    generated_at: string;
    count: number;
    candidates: StockCandidate[];
  }> {
    this.logger.log('Manual watchlist request triggered.');
    const candidates = await this.scannerService.runScanner();
    return {
      generated_at: new Date().toISOString(),
      count: candidates.length,
      candidates,
    };
  }

  /**
   * GET /scanner/dates
   * Returns available dates in MySQL (stock-training). For date picker.
   */
  @Get('dates')
  async getDates(): Promise<{ dates: string[] }> {
    const dates = await this.dataSourceFactory.getAvailableDates();
    return { dates };
  }

  /**
   * GET /scanner/snapshot/:ticker?cutoff=<unix_ms>&date=YYYY-MM-DD
   * Returns snapshot for a ticker. date=today or omitted → momoscreener. date=historical → MySQL.
   * cutoff: simulation/replay trim. Includes strategy detection.
   */
  @Get('snapshot/:ticker')
  async getSnapshot(
    @Param('ticker') ticker: string,
    @Query('cutoff') cutoff?: string,
    @Query('date') date?: string,
  ): Promise<StockSnapshotWithStrategy> {
    const cutoffMs = cutoff ? parseInt(cutoff, 10) : undefined;
    const source = this.dataSourceFactory.getDataSource(date);
    const snap = await source.getStockSnapshot(ticker.toUpperCase(), {
      cutoffMs,
      timeframe: '5m',
      date,
    });

    // Real-time strategy detection via trading rules engine
    const refDate = cutoffMs ? new Date(cutoffMs) : new Date();
    const etTime = refDate.toLocaleTimeString('en-CA', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }); // "14:30" format for getSession
    const session = getSession(etTime);

    const candlesForRules = snap.candles_5min;
    const rules = applyTradingRules({
      ticker: snap.ticker,
      price: snap.price,
      vwap: snap.vwap,
      ema9: snap.ema9,
      ema20: snap.ema20,
      relative_volume: snap.relative_volume,
      change_pct: snap.change_pct,
      atr: snap.atr,
      session,
      pre_market_high: snap.pre_market_high,
      account_size: 25000,
      last_candles_json: JSON.stringify(candlesForRules.slice(-30)),
    });

    return {
      ...snap,
      strategy: {
        name: rules.identified_strategy,
        viable: rules.viable,
        entry: rules.entry_zone?.price ?? null,
        stop: rules.stop_loss?.price ?? null,
        target_1: rules.target_1?.price ?? null,
        target_2: rules.target_2?.price ?? null,
        pattern_signals: rules.pattern_signals ?? [],
        pattern_points: (rules.detected_patterns ?? []).flatMap(p => p.anchor_points),
        strategy_guidance: rules.strategy_guidance ?? null,
      },
    };
  }

  /**
   * GET /scanner/strategy/:ticker?cutoff=<unix_ms>
   * Lightweight: returns only the current pattern in play (for UI polling every 1s).
   */
  @Get('strategy/:ticker')
  async getPattern(
    @Param('ticker') ticker: string,
    @Query('cutoff') cutoff?: string,
    @Query('date') date?: string,
  ): Promise<{
    name: string | null;
    viable: boolean;
    points: PatternPoint[];
    strategy_guidance: StrategyGuidance | null;
  }> {
    const cutoffMs = cutoff ? parseInt(cutoff, 10) : undefined;
    const source = this.dataSourceFactory.getDataSource(date);
    const snap = await source.getStockSnapshot(ticker.toUpperCase(), { cutoffMs, timeframe: '5m', date });

    const refDate = cutoffMs ? new Date(cutoffMs) : new Date();
    const etTime = refDate.toLocaleTimeString('en-CA', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const session = getSession(etTime);

    const candlesForRules = snap.candles_5min;
    const rules = applyTradingRules({
      ticker: snap.ticker,
      price: snap.price,
      vwap: snap.vwap,
      ema9: snap.ema9,
      ema20: snap.ema20,
      relative_volume: snap.relative_volume,
      change_pct: snap.change_pct,
      atr: snap.atr,
      session,
      pre_market_high: snap.pre_market_high,
      account_size: 25000,
      last_candles_json: JSON.stringify(candlesForRules.slice(-30)),
    });

    return {
      name: rules.identified_strategy,
      viable: rules.viable,
      points: (rules.detected_patterns ?? []).flatMap(p => p.anchor_points),
      strategy_guidance: rules.strategy_guidance ?? null,
    };
  }

  /**
   * GET /scanner/news/:ticker
   * Returns news headlines and catalyst analysis for a ticker.
   */
  @Get('news/:ticker')
  async getNews(@Param('ticker') ticker: string): Promise<CatalystAnalysis> {
    const sym = ticker.toUpperCase();
    let headlines: NewsItem[] = await fetchYahooNews(sym);
    if (!headlines.length) headlines = await fetchFinvizNews(sym);

    const { strength, catalyst_type, is_dilutive, justifies_move } =
      await scoreHeadlines(headlines);

    const recentCount = headlines.filter((h) => h.age_minutes < 60).length;
    const confidence =
      strength === 'NONE' ? 0.1
      : strength === 'WEAK' ? 0.3
      : strength === 'MODERATE' ? 0.6
      : recentCount > 0 ? 0.9 : 0.7;

    let trade_implication = '';
    if (is_dilutive) {
      trade_implication = 'AVOID LONG — Dilutive event detected. Stock likely to sell off.';
    } else if (strength === 'STRONG') {
      trade_implication = 'Move is justified. Look for bull flag, ABCD, or ORB setup on a pullback. High conviction.';
    } else if (strength === 'MODERATE') {
      trade_implication = 'Some basis but take smaller size. Wait for clean technical setup. Risk of reversal.';
    } else if (strength === 'WEAK') {
      trade_implication = 'Caution on longs. News may cap upside or cause sell-the-news.';
    } else {
      trade_implication = 'No news catalyst — pure technical move. High risk of reversal. Use tight stops.';
    }

    return {
      ticker: sym,
      headlines,
      catalyst_strength: strength,
      catalyst_type,
      justifies_move,
      confidence,
      is_dilutive,
      summary: `${headlines.length} headline(s) found. Catalyst: ${catalyst_type}.`,
      trade_implication,
    } as CatalystAnalysis;
  }

  /**
   * GET /scanner/topmovers?date=YYYY-MM-DD
   * date=today o omitido → momoscreener (live). date=histórico → MySQL (stock-training).
   */
  @Get('topmovers')
  async getTopMovers(@Query('date') date?: string): Promise<MomoStock[]> {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (!date || date === today) {
      return this.getMomoFromApi();
    }
    return this.getMomoFromMysql(date);
  }

  private async getMomoFromMysql(dateStr: string): Promise<MomoStock[]> {
    const rows = await this.mysqlRepo.getTopMovers(dateStr);
    return rows.map((r): MomoStock => ({
      symbol: r.symbol,
      price: r.close,
      change: r.change_pct * 100, // MySQL tiene 0.35 = 35%, momo usa 35
      change5m: 0,
      volume: r.volume,
      float: null,
      headline: '',
      headline_source: 'MySQL',
      ideal: r.change_pct >= 0.10,
    }));
  }

  private async getMomoFromApi(): Promise<MomoStock[]> {
    return this.getMomo('5', '3');
  }

  /**
   * GET /scanner/momo?int=5&change=3
   * Returns deduplicated list of top movers from momoscreener momo API (live only).
   * @deprecated Use GET /scanner/top-movers?date= for date-aware list.
   */
  @Get('momo')
  async getMomo(
    @Query('int') interval = '5',
    @Query('change') change = '3',
  ): Promise<MomoStock[]> {
    const url = `https://momoscreener.com/api/momo?int=${interval}&change=${change}`;
    let items: any[] = [];
    try {
      const res = await axios.get(url, { timeout: 10000 });
      items = res.data?.message ?? [];
    } catch (err: any) {
      this.logger.warn(`momo API failed: ${err?.message || err}`);
      return []; // Return empty list so UI doesn't break; user can type ticker manually
    }

    const volOf = (item: any) =>
      item.live?.totalVolume ?? item.stats?.volume ?? item.quote?.totalVolume ?? 0;

    // Deduplicate by symbol — keep the entry with highest volume
    const bySymbol = new Map<string, any>();
    for (const item of items) {
      const sym: string = item.symbol;
      if (!sym) continue;
      const existing = bySymbol.get(sym);
      const vol = volOf(item);
      if (!existing || vol > volOf(existing)) {
        bySymbol.set(sym, item);
      }
    }

    const IDEAL_PRICE_MIN = 2;
    const IDEAL_PRICE_MAX = 20;
    const IDEAL_CHANGE_PCT = 10;
    const IDEAL_FLOAT_MAX = 20_000_000;
    const IDEAL_REL_VOL = 5;

    const headlineOf = (item: any) => {
      const n = item.news;
      const raw = Array.isArray(n) ? n[0]?.headline : n?.headline;
      return raw ? String(raw).replace(/&#39;/g, "'").replace(/&amp;/g, '&') : '';
    };
    const sourceOf = (item: any) => {
      const n = item.news;
      return (Array.isArray(n) ? n[0]?.source : n?.source) ?? '';
    };

    const mapped: MomoStock[] = [...bySymbol.values()].map((item): MomoStock => {
      const price = item.live?.lastPrice ?? item.stats?.price ?? item.quote?.lastPrice ?? 0;
      const change = item.change ?? 0;
      const volume = volOf(item);
      const float = item.stats?.floatShares ?? null;
      const headline = headlineOf(item);
      const avgVol = item.stats?.avgVolume ?? item.quote?.totalVolume;
      const relVol = avgVol && avgVol > 0 ? volume / avgVol : null;

      const ideal =
        price >= IDEAL_PRICE_MIN && price <= IDEAL_PRICE_MAX &&
        change >= IDEAL_CHANGE_PCT &&
        (float == null || float <= IDEAL_FLOAT_MAX) &&
        !!headline?.trim() &&
        (relVol == null || relVol >= IDEAL_REL_VOL);

      return {
        symbol: item.symbol,
        price,
        change,
        change5m: item.change5m ?? 0,
        volume,
        float,
        headline,
        headline_source: sourceOf(item),
        ideal,
      };
    });

    // Sort by change descending (hot movers first)
    mapped.sort((a, b) => b.change - a.change);
    return mapped;
  }
}
