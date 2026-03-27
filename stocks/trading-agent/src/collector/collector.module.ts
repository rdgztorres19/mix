import { Module, forwardRef } from '@nestjs/common';
import { ScannerModule } from '../scanner/scanner.module';
import { ScreenerModule } from '../scanner/screener/screener.module';
import { TraderModule } from '../trader/trader.module';
import { WebSocketModule } from '../websocket/websocket.module';
import { CollectorService } from './collector.service';
import { CollectorCron } from './collector.cron';
import { MomoStreamService } from './momo-stream.service';
import { CollectorGateway } from './collector.gateway';
import { CollectorController } from './collector.controller';
import { TopGainersSourceService } from './top-gainers-source.service';
import { ScannedTrackerService } from './tracker/scanned-tracker.service';
import { ScannedTrackerCron } from './tracker/scanned-tracker.cron';
import { ScannedTrackerController } from './tracker/scanned-tracker.controller';
import { CollectorFeaturePreviewService } from './collector-feature-preview.service';

@Module({
  imports: [ScannerModule, ScreenerModule, TraderModule, forwardRef(() => WebSocketModule)],
  controllers: [CollectorController, ScannedTrackerController],
  providers: [
    TopGainersSourceService,
    CollectorService,
    CollectorFeaturePreviewService,
    CollectorCron,
    MomoStreamService,
    CollectorGateway,
    ScannedTrackerService,
    ScannedTrackerCron,
    {
      provide: 'COLLECTOR_SERVICE',
      useExisting: CollectorService,
    },
  ],
  exports: [CollectorService, MomoStreamService, CollectorGateway, ScannedTrackerService, 'COLLECTOR_SERVICE'],
})
export class CollectorModule {}
