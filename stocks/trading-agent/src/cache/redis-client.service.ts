import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisClientService.name);
  private redis: Redis | null = null;

  onModuleInit(): void {
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

      this.redis.connect().catch((err) => {
        this.logger.warn(`Redis initial connect failed: ${err.message}`);
      });
    } catch (err) {
      this.logger.warn(`Redis init failed: ${(err as Error).message}`);
      this.redis = null;
    }
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  getClient(): Redis | null {
    return this.redis;
  }

  isReady(): boolean {
    return this.redis != null;
  }
}
