import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { RagModule } from './rag/rag.module';
import { AgentModule } from './agent/agent.module';
import { ScannerModule } from './scanner/scanner.module';
import { AnalysisLogModule } from './analysis-log/analysis-log.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AnalysisLogModule,
    RagModule,
    AgentModule,
    ScannerModule,
  ],
})
export class AppModule {}
