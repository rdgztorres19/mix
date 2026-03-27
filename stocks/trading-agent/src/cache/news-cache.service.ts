import { Injectable, Logger } from '@nestjs/common';
import { RedisClientService } from './redis-client.service';

export interface CachedCatalyst {
  strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  catalyst_type: string;
  is_dilutive: boolean;
  justifies_move: boolean;
  headlines_sample: string[];
  cached_at: number; // unix ms
}

@Injectable()
export class NewsCacheService {
  private readonly logger = new Logger(NewsCacheService.name);
  private readonly ttlSec: number;
  private readonly keyPrefix = 'news_catalyst:';

  constructor(private readonly redisClient: RedisClientService) {
    this.ttlSec = parseInt(process.env.NEWS_CACHE_TTL_SEC ?? '300', 10);
    if (this.ttlSec === 0) {
      this.logger.warn('NEWS_CACHE_TTL_SEC=0 — news cache disabled');
    }
  }

  private key(ticker: string): string {
    return `${this.keyPrefix}${ticker.toUpperCase()}`;
  }

  async get(ticker: string): Promise<CachedCatalyst | null> {
    const redis = this.redisClient.getClient();
    if (!redis || this.ttlSec === 0) return null;
    try {
      const raw = await redis.get(this.key(ticker));
      if (!raw) return null;
      const parsed: CachedCatalyst = JSON.parse(raw);
      const ageMs = Date.now() - parsed.cached_at;
      this.logger.log(`[Cache HIT] ${ticker} catalyst=${parsed.strength} age=${Math.round(ageMs / 1000)}s`);
      return parsed;
    } catch (err) {
      this.logger.warn(`Cache get error for ${ticker}: ${(err as Error).message}`);
      return null;
    }
  }

  async set(ticker: string, catalyst: Omit<CachedCatalyst, 'cached_at'>): Promise<void> {
    const redis = this.redisClient.getClient();
    if (!redis || this.ttlSec === 0) return;
    try {
      const value: CachedCatalyst = { ...catalyst, cached_at: Date.now() };
      await redis.set(this.key(ticker), JSON.stringify(value), 'EX', this.ttlSec);
      this.logger.log(`[Cache SET] ${ticker} catalyst=${catalyst.strength} TTL=${this.ttlSec}s`);
    } catch (err) {
      this.logger.warn(`Cache set error for ${ticker}: ${(err as Error).message}`);
    }
  }

  async invalidate(ticker: string): Promise<void> {
    const redis = this.redisClient.getClient();
    if (!redis) return;
    try {
      await redis.del(this.key(ticker));
      this.logger.log(`[Cache INVALIDATE] ${ticker}`);
    } catch (err) {
      this.logger.warn(`Cache invalidate error for ${ticker}: ${(err as Error).message}`);
    }
  }

  async ttlRemaining(ticker: string): Promise<number> {
    const redis = this.redisClient.getClient();
    if (!redis) return -2;
    try {
      return await redis.ttl(this.key(ticker));
    } catch {
      return -2;
    }
  }
}
