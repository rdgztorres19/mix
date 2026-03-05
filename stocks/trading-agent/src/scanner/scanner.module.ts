import { Module } from '@nestjs/common';
import { ScannerService } from './scanner.service';
import { ScannerController } from './scanner.controller';
import { ScannerCron } from './scanner.cron';

@Module({
  providers: [ScannerService, ScannerCron],
  controllers: [ScannerController],
  exports: [ScannerService],
})
export class ScannerModule {}
