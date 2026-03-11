import { Module } from '@nestjs/common';
import { ScannerService } from './scanner.service';
import { ScannerController } from './scanner.controller';
import { ScannerCron } from './scanner.cron';
import { MysqlTrainingRepository } from './mysql/mysql-training.repository';
import { AlpacaDataSource } from './datasource/alpaca-datasource';
import { MomoDataSource } from './datasource/momo-datasource';
import { MysqlDataSource } from './datasource/mysql-datasource';
import { StockDataSourceFactory } from './datasource/datasource.factory';

@Module({
  providers: [
    ScannerService,
    ScannerCron,
    MysqlTrainingRepository,
    AlpacaDataSource,   // 🎯 Premium Alpaca SIP feed (primary source)
    MomoDataSource,     // 🚫 DISABLED - kept for DI compatibility 
    MysqlDataSource,    // 💾 Historical data from stock-training
    StockDataSourceFactory,
  ],
  controllers: [ScannerController],
  exports: [
    ScannerService, 
    MysqlTrainingRepository,
    AlpacaDataSource,   // Export for WebSocket module
    MomoDataSource,     // Export for WebSocket module (disabled but kept for DI)
    StockDataSourceFactory,
  ],
})
export class ScannerModule {}
