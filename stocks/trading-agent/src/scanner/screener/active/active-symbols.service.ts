import { Injectable, Logger } from '@nestjs/common';
import { ScreenerRepository, type ScreenerRankType } from '../persistence/screener.repository';

const RANK_TYPES_FOR_ACTIVE: ScreenerRankType[] = [
  'gapper',
  'gainer_intraday',
  'gainer_session',
  'high_session',
  'high_current',
];

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Merges up to TOP_N from each category, dedupes by symbol, score = max(metric_value), keeps global TOP_N.
 */
@Injectable()
export class ActiveSymbolsService {
  private readonly logger = new Logger(ActiveSymbolsService.name);

  constructor(private readonly repo: ScreenerRepository) {}

  private topN(): number {
    return toPositiveInt(process.env.SCREENER_TOP_N, 40);
  }

  async rebuildFromStoredRanks(sessionDate: string): Promise<{ count: number }> {
    const n = this.topN();
    const bySymbol = new Map<string, number>();

    for (const rt of RANK_TYPES_FOR_ACTIVE) {
      const rows = await this.repo.getRankRows(rt);
      const slice = rows.slice(0, n);
      for (const r of slice) {
        const sym = r.symbol.toUpperCase();
        const prev = bySymbol.get(sym) ?? 0;
        const score = Math.max(prev, Math.abs(r.metric_value));
        bySymbol.set(sym, score);
      }
    }

    const sorted = [...bySymbol.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n);

    const entries = sorted.map(([symbol, score], i) => ({
      rank_order: i + 1,
      symbol,
      score,
    }));

    await this.repo.replaceActiveSymbols(entries, sessionDate);
    this.logger.log(`active symbols updated: ${entries.length}`);
    return { count: entries.length };
  }

  async getActive(sessionDate: string): Promise<{ rank_order: number; symbol: string; score: number }[]> {
    return this.repo.getActiveSymbols(sessionDate);
  }
}
