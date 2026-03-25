import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { RagModule } from './rag/rag.module';
import { AgentModule } from './agent/agent.module';
import { ScannerModule } from './scanner/scanner.module';
import { AnalysisLogModule } from './analysis-log/analysis-log.module';
import { CacheModule } from './cache/cache.module';
import { PredictorModule } from './predictor/predictor.module';
import { CollectorModule } from './collector/collector.module';
import { TraderModule } from './trader/trader.module';
import { WebSocketModule } from './websocket/websocket.module';
import { ScreenerModule } from './screener/screener.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AnalysisLogModule,
    RagModule,
    AgentModule,
    ScannerModule,
    WebSocketModule, // 🚀 Real-time WebSocket data streaming
    CacheModule,
    PredictorModule,
    CollectorModule,
    TraderModule,
    ScreenerModule,
  ],
})
export class AppModule {}
