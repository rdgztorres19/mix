import { Module } from '@nestjs/common';
import { NewsCacheService } from './news-cache.service';

@Module({
  providers: [NewsCacheService],
  exports: [NewsCacheService],
})
export class CacheModule {}
