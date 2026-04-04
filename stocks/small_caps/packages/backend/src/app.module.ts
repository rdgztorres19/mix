import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { DataSyncModule } from './data-sync/data-sync.module';
import { ScreenerModule } from './screener/screener.module';
import { ChartModule } from './chart/chart.module';
import { SimulatorModule } from './simulator/simulator.module';
import { PredictorModule } from './predictor/predictor.module';
import { ensureDatabaseExists } from './database/ensure-database';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: async () => {
        const dbName = process.env.MYSQL_DATABASE ?? 'small_caps';
        await ensureDatabaseExists({
          host: process.env.MYSQL_HOST ?? 'localhost',
          port: parseInt(process.env.MYSQL_PORT ?? '3306', 10),
          user: process.env.MYSQL_USER ?? 'root',
          password: process.env.MYSQL_PASSWORD ?? '',
          database: dbName,
        });
        return {
          type: 'mysql' as const,
          host: process.env.MYSQL_HOST ?? 'localhost',
          port: parseInt(process.env.MYSQL_PORT ?? '3306', 10),
          username: process.env.MYSQL_USER ?? 'root',
          password: process.env.MYSQL_PASSWORD ?? '',
          database: dbName,
          entities: [__dirname + '/database/entities/*.entity{.ts,.js}'],
          synchronize: true,
        };
      },
    }),
    DatabaseModule,
    RedisModule,
    DataSyncModule,
    ScreenerModule,
    ChartModule,
    SimulatorModule,
    PredictorModule,
  ],
})
export class AppModule {}
