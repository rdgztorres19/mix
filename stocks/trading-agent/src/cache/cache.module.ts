import { Module } from '@nestjs/common';
import { RedisClientService } from './redis-client.service';
import { NewsCacheService } from './news-cache.service';

@Module({
  providers: [RedisClientService, NewsCacheService],
  exports: [RedisClientService, NewsCacheService],
})
export class CacheModule {}
