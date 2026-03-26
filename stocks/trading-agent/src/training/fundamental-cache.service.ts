/**
 * Fundamentals: MySQL stock_profile + in-memory Map + Finnhub backfill.
 * Duplicated Finnhub parsing from stock-training fundamental-fetcher — keep in sync.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import axios from 'axios';
import { MysqlTrainingRepository } from '../scanner/mysql/mysql-training.repository';

export interface Fundamentals {
  sharesOutstanding: number | null;
  marketCap: number | null;
}

const EMPTY: Fundamentals = { sharesOutstanding: null, marketCap: null };

function resolveStockProfileCsvPath(): string {
  const override = process.env.STOCK_PROFILE_CSV_PATH?.trim();
  if (override) return path.resolve(override);
  return path.resolve(process.cwd(), '..', 'stock-training', 'data', 'stock_profile.csv');
}

function parseStockProfileCsv(filePath: string): Array<{
  symbol: string;
  sharesOutstanding: number | null;
  marketCap: number | null;
}> {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const out: Array<{ symbol: string; sharesOutstanding: number | null; marketCap: number | null }> = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const symbol = (parts[0] ?? '').trim().toUpperCase();
    if (!symbol) continue;

    const soRaw = (parts[1] ?? '').trim();
    const mcRaw = (parts[2] ?? '').trim();
    const soNum = soRaw === '' ? NaN : parseFloat(soRaw);
    const mcNum = mcRaw === '' ? NaN : parseFloat(mcRaw);

    out.push({
      symbol,
      sharesOutstanding: !isNaN(soNum) && soNum > 0 ? soNum : null,
      marketCap: !isNaN(mcNum) && mcNum > 0 ? mcNum : null,
    });
  }
  return out;
}

@Injectable()
export class FundamentalCacheService implements OnModuleInit {
  private readonly logger = new Logger(FundamentalCacheService.name);
  private readonly cache = new Map<string, Fundamentals>();
  private envLoaded = false;

  constructor(private readonly mysqlRepo: MysqlTrainingRepository) {}

  async onModuleInit(): Promise<void> {
    await this.mysqlRepo.ensureStockProfileTable();
    const count = await this.mysqlRepo.countStockProfileRows();
    const csvPath = resolveStockProfileCsvPath();
    const csvRows = parseStockProfileCsv(csvPath);

    if (count === 0 && csvRows.length > 0) {
      await this.mysqlRepo.bulkReplaceStockProfiles(csvRows);
      this.logger.log(`Seeded stock_profile from CSV (${csvRows.length} rows) → ${csvPath}`);
    } else if (count === 0 && csvRows.length === 0) {
      this.logger.warn(`stock_profile empty and no CSV at ${csvPath}; fundamentals will use Finnhub only`);
    }

    let loaded = await this.mysqlRepo.loadAllStockProfiles();
    if (loaded.size === 0 && csvRows.length > 0) {
      for (const r of csvRows) {
        loaded.set(r.symbol, { sharesOutstanding: r.sharesOutstanding, marketCap: r.marketCap });
      }
      this.logger.log(`Fundamentals: loaded ${csvRows.length} symbols from CSV (MySQL empty or unavailable)`);
    }

    for (const [sym, v] of loaded) {
      this.cache.set(sym, v);
    }
    this.logger.log(`Fundamentals cache ready: ${this.cache.size} symbols`);
  }

  private ensureFinnhubKeyLoaded(): void {
    if (this.envLoaded || process.env.FINNHUB_API_KEY) return;
    this.envLoaded = true;
    try {
      const dotenv = require('dotenv');
      const stockTrainingEnv = path.resolve(process.cwd(), '..', 'stock-training', '.env');
      dotenv.config({ path: stockTrainingEnv });
    } catch {
      /* ignore */
    }
  }

  private async fetchFromFinnhub(ticker: string, token: string): Promise<Fundamentals> {
    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${token}`;
    const res = await axios.get(url, { timeout: 8000 });
    const profile = res.data ?? {};

    const so = profile.shareOutstanding ?? profile.share_outstanding;
    const soNum = typeof so === 'number' ? so : typeof so === 'string' ? parseFloat(so) : NaN;
    const sharesOutstanding =
      !isNaN(soNum) && soNum > 0 ? soNum * 1_000_000 : null;

    const mc = profile.marketCapitalization ?? profile.market_capitalization;
    const mcNum = typeof mc === 'number' ? mc : typeof mc === 'string' ? parseFloat(mc) : NaN;
    const marketCap = !isNaN(mcNum) && mcNum > 0 ? mcNum : null;

    return { sharesOutstanding, marketCap };
  }

  /**
   * Get fundamentals for symbol. Memory first (seeded from MySQL / CSV), then Finnhub on miss.
   * Persists Finnhub hits to MySQL when at least one field is non-null.
   */
  async getFundamentals(symbol: string): Promise<Fundamentals> {
    const key = symbol.toUpperCase();
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    this.ensureFinnhubKeyLoaded();
    const token = process.env.FINNHUB_API_KEY?.trim();
    if (!token) {
      this.cache.set(key, EMPTY);
      return EMPTY;
    }

    try {
      const result = await this.fetchFromFinnhub(key, token);
      this.cache.set(key, result);
      if (result.sharesOutstanding != null || result.marketCap != null) {
        await this.mysqlRepo.upsertStockProfile(key, result.sharesOutstanding, result.marketCap);
      }
      return result;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429) throw err;
      this.cache.set(key, EMPTY);
      return EMPTY;
    }
  }
}
