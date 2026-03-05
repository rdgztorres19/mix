import { Controller, Get, Param, Query, Logger } from '@nestjs/common';
import axios from 'axios';
import { ScannerService, StockCandidate, StockSnapshot } from './scanner.service';

export interface MomoStock {
  symbol: string;
  price: number;
  change: number;
  change5m: number;
  volume: number;
  float: number | null;
  headline: string;
  headline_source: string;
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

  constructor(private readonly scannerService: ScannerService) {}

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
   * GET /scanner/snapshot/:ticker?cutoff=<unix_ms>
   * Returns snapshot for a ticker. If cutoff is provided, data is trimmed
   * to only include candles up to that timestamp (simulation / replay mode).
   */
  @Get('snapshot/:ticker')
  async getSnapshot(
    @Param('ticker') ticker: string,
    @Query('cutoff') cutoff?: string,
  ): Promise<StockSnapshot> {
    const cutoffMs = cutoff ? parseInt(cutoff, 10) : undefined;
    return this.scannerService.getStockSnapshot(ticker.toUpperCase(), cutoffMs);
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
      scoreHeadlines(headlines);

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
   * GET /scanner/momo?int=5&change=3
   * Returns deduplicated list of top movers from momoscreener momo API.
   */
  @Get('momo')
  async getMomo(
    @Query('int') interval = '5',
    @Query('change') change = '3',
  ): Promise<MomoStock[]> {
    const url = `https://momoscreener.com/api/momo?int=${interval}&change=${change}`;
    const res = await axios.get(url, { timeout: 8000 });
    const items: any[] = res.data?.message ?? [];

    // Deduplicate by symbol — keep the entry with highest volume
    const bySymbol = new Map<string, any>();
    for (const item of items) {
      const sym: string = item.symbol;
      if (!sym) continue;
      const existing = bySymbol.get(sym);
      const vol = item.quote?.totalVolume ?? 0;
      if (!existing || vol > (existing.quote?.totalVolume ?? 0)) {
        bySymbol.set(sym, item);
      }
    }

    const mapped = [...bySymbol.values()].map((item): MomoStock => ({
      symbol: item.symbol,
      price: item.live?.lastPrice ?? item.stats?.price ?? item.quote?.lastPrice ?? 0,
      change: item.change ?? 0,
      change5m: item.change5m ?? 0,
      volume: item.quote?.totalVolume ?? 0,
      float: item.stats?.floatShares ?? null,
      headline: item.news?.headline
        ? item.news.headline.replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        : '',
      headline_source: item.news?.source ?? '',
    }));

    // Filter by ideal Stock in Play conditions:
    // Price $2–$20 | Change ≥10% | Rel vol ≥5x | Catalyst (news) | Float <20M
    const IDEAL_PRICE_MIN = 2;
    const IDEAL_PRICE_MAX = 20;
    const IDEAL_CHANGE_PCT = 10;
    const IDEAL_REL_VOL = 5;
    const IDEAL_FLOAT_MAX = 20_000_000;

    return mapped.filter((s) => {
      if (s.price < IDEAL_PRICE_MIN || s.price > IDEAL_PRICE_MAX) return false;
      if (s.change < IDEAL_CHANGE_PCT) return false;
      // Float: exclude if known and >20M; allow if null (unknown)
      if (s.float != null && s.float > IDEAL_FLOAT_MAX) return false;
      // Catalyst: must have news headline (technical breakout not detectable from momo API)
      if (!s.headline?.trim()) return false;
      // Rel vol: need avgVolume from source — use raw item to compute
      const raw = [...bySymbol.values()].find((x) => x.symbol === s.symbol);
      const avgVol = raw?.stats?.avgVolume ?? raw?.quote?.totalVolume;
      if (avgVol && avgVol > 0) {
        const relVol = s.volume / avgVol;
        if (relVol < IDEAL_REL_VOL) return false;
      }
      return true;
    });
  }
}
