import { Module } from '@nestjs/common';
import { ScannerService } from './scanner.service';
import { ScannerController } from './scanner.controller';
import { ScannerCron } from './scanner.cron';
import { MysqlTrainingRepository } from './mysql/mysql-training.repository';
import { MomoDataSource } from './datasource/momo-datasource';
import { MysqlDataSource } from './datasource/mysql-datasource';
import { StockDataSourceFactory } from './datasource/datasource.factory';

@Module({
  providers: [
    ScannerService,
    ScannerCron,
    MysqlTrainingRepository,
    MomoDataSource,
    MysqlDataSource,
    StockDataSourceFactory,
  ],
  controllers: [ScannerController],
  exports: [ScannerService],
})
export class ScannerModule {}
