import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AlpacaWebSocketService } from './alpaca-websocket.service';
import { WebSocketFallbackCron } from './websocket-fallback.cron';
import { WebSocketInitService } from './websocket-init.service';
import { ScannerModule } from '../scanner/scanner.module';
import { CollectorModule } from '../collector/collector.module';

/**
 * WebSocket Module - handles real-time data streaming and fallback logic.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ScannerModule, // Import ScannerModule to access AlpacaDataSource and MomoDataSource
    forwardRef(() => CollectorModule), // Import CollectorModule with forwardRef to avoid circular dependency
  ],
  providers: [
    AlpacaWebSocketService,
    WebSocketFallbackCron,
    WebSocketInitService,  // 🚀 Auto-start WebSocket on app startup
    {
      provide: 'WEB_SOCKET_INIT_SERVICE',
      useExisting: WebSocketInitService,
    },
  ],
  exports: [AlpacaWebSocketService, WebSocketInitService],
})
export class WebSocketModule {}