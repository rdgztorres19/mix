import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Candle1mEntity } from './entities/candle-1m.entity';
import { StockNewsEntity } from './entities/stock-news.entity';
import { StockProfileEntity } from './entities/stock-profile.entity';
import { SyncMetaEntity } from './entities/sync-meta.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Candle1mEntity,
      StockNewsEntity,
      StockProfileEntity,
      SyncMetaEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
