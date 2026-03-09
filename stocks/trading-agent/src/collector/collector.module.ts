import { Module } from '@nestjs/common';
import { ScannerModule } from '../scanner/scanner.module';
import { CollectorService } from './collector.service';
import { CollectorCron } from './collector.cron';
import { MomoStreamService } from './momo-stream.service';
import { CollectorGateway } from './collector.gateway';

@Module({
  imports: [ScannerModule],
  providers: [
    CollectorService,
    CollectorCron,
    MomoStreamService,
    CollectorGateway,
  ],
  exports: [CollectorService],
})
export class CollectorModule {}
