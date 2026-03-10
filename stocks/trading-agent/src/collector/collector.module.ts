import { Module } from '@nestjs/common';
import { ScannerModule } from '../scanner/scanner.module';
import { TraderModule } from '../trader/trader.module';
import { CollectorService } from './collector.service';
import { CollectorCron } from './collector.cron';
import { MomoStreamService } from './momo-stream.service';
import { CollectorGateway } from './collector.gateway';
import { CollectorController } from './collector.controller';

@Module({
  imports: [ScannerModule, TraderModule],
  controllers: [CollectorController],
  providers: [
    CollectorService,
    CollectorCron,
    MomoStreamService,
    CollectorGateway,
  ],
  exports: [CollectorService],
})
export class CollectorModule {}
