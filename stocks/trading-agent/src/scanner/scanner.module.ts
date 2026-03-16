import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ScannerService } from './scanner.service';
import { ScannerController } from './scanner.controller';
import { ScannerCron } from './scanner.cron';
import { MysqlTrainingRepository } from './mysql/mysql-training.repository';
import { AlpacaDataSource } from './datasource/alpaca-datasource';
import { MomoDataSource } from './datasource/momo-datasource';
import { MysqlDataSource } from './datasource/mysql-datasource';
import { StockDataSourceFactory } from './datasource/datasource.factory';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [
    ScannerController,
  ],
  providers: [
    ScannerService,
    ScannerCron,
    AlpacaDataSource,
    MomoDataSource,
    MysqlDataSource,
    StockDataSourceFactory,
    MysqlTrainingRepository,
  ],
  exports: [
    ScannerService, 
    MysqlTrainingRepository,
    AlpacaDataSource,   // Export for WebSocket module
    MomoDataSource,     // Export for WebSocket module (disabled but kept for DI)
  ],
})
export class ScannerModule {}
