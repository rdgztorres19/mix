import { Module, forwardRef } from '@nestjs/common';
import { ScannerModule } from '../scanner/scanner.module';
import { TraderModule } from '../trader/trader.module';
import { WebSocketModule } from '../websocket/websocket.module';
import { CollectorService } from './collector.service';
import { CollectorCron } from './collector.cron';
import { MomoStreamService } from './momo-stream.service';
import { CollectorGateway } from './collector.gateway';
import { CollectorController } from './collector.controller';
import { TopGainersSourceService } from './top-gainers-source.service';

@Module({
  imports: [ScannerModule, TraderModule, forwardRef(() => WebSocketModule)],
  controllers: [CollectorController],
  providers: [
    TopGainersSourceService,
    CollectorService,
    CollectorCron,
    MomoStreamService,
    CollectorGateway,
    {
      provide: 'COLLECTOR_SERVICE',
      useExisting: CollectorService,
    },
  ],
  exports: [CollectorService, MomoStreamService, CollectorGateway, 'COLLECTOR_SERVICE'],
})
export class CollectorModule {}
