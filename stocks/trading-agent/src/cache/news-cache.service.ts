import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

export interface CachedCatalyst {
  strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  catalyst_type: string;
  is_dilutive: boolean;
  justifies_move: boolean;
  headlines_sample: string[];
  cached_at: number; // unix ms
}

/**
 * Redis-backed cache for news catalyst analysis results.
 *
 * Key pattern:  news_catalyst:{TICKER}
 * TTL:          NEWS_CACHE_TTL_SEC env var (default 300s = 5 minutes)
 *               Use a shorter TTL during market open (high news flow) and
 *               longer in midday/close. Set to 0 to disable caching.
 *
 * Falls back gracefully if Redis is unreachable — caching errors are never fatal.
 */
@Injectable()
export class NewsCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NewsCacheService.name);
  private redis: Redis | null = null;
  private readonly ttlSec: number;
  private readonly keyPrefix = 'news_catalyst:';

  constructor() {
    this.ttlSec = parseInt(process.env.NEWS_CACHE_TTL_SEC ?? '300', 10);
  }

  onModuleInit() {
    if (this.ttlSec === 0) {
      this.logger.warn('NEWS_CACHE_TTL_SEC=0 — news cache disabled');
      return;
    }

    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    try {
      this.redis = new Redis(url, {
        lazyConnect: true,
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });

      this.redis.on('connect', () => this.logger.log(`Redis connected → ${url}`));
      this.redis.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`));

      this.redis.connect().catch((err) =>
        this.logger.warn(`Redis initial connect failed: ${err.message} — cache disabled for this session`),
      );
    } catch (err) {
      this.logger.warn(`Redis init failed: ${err.message} — cache disabled`);
      this.redis = null;
    }
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  private key(ticker: string): string {
    return `${this.keyPrefix}${ticker.toUpperCase()}`;
  }

  async get(ticker: string): Promise<CachedCatalyst | null> {
    if (!this.redis || this.ttlSec === 0) return null;
    try {
      const raw = await this.redis.get(this.key(ticker));
      if (!raw) return null;
      const parsed: CachedCatalyst = JSON.parse(raw);
      const ageMs = Date.now() - parsed.cached_at;
      this.logger.log(`[Cache HIT] ${ticker} catalyst=${parsed.strength} age=${Math.round(ageMs / 1000)}s`);
      return parsed;
    } catch (err) {
      this.logger.warn(`Cache get error for ${ticker}: ${err.message}`);
      return null;
    }
  }

  async set(ticker: string, catalyst: Omit<CachedCatalyst, 'cached_at'>): Promise<void> {
    if (!this.redis || this.ttlSec === 0) return;
    try {
      const value: CachedCatalyst = { ...catalyst, cached_at: Date.now() };
      await this.redis.set(this.key(ticker), JSON.stringify(value), 'EX', this.ttlSec);
      this.logger.log(`[Cache SET] ${ticker} catalyst=${catalyst.strength} TTL=${this.ttlSec}s`);
    } catch (err) {
      this.logger.warn(`Cache set error for ${ticker}: ${err.message}`);
    }
  }

  /** Force-invalidate a ticker's cache (e.g. after a breaking news event). */
  async invalidate(ticker: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.key(ticker));
      this.logger.log(`[Cache INVALIDATE] ${ticker}`);
    } catch (err) {
      this.logger.warn(`Cache invalidate error for ${ticker}: ${err.message}`);
    }
  }

  /** Returns cache TTL remaining in seconds (-1 = no TTL, -2 = key missing). */
  async ttlRemaining(ticker: string): Promise<number> {
    if (!this.redis) return -2;
    try {
      return await this.redis.ttl(this.key(ticker));
    } catch {
      return -2;
    }
  }
}
