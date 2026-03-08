import { Module } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { RagModule } from '../rag/rag.module';
import { ScannerModule } from '../scanner/scanner.module';
import { CacheModule } from '../cache/cache.module';
import { AnalysisResponseBuilder } from './pipeline/analysis-response.builder';
import { AgenticPipeline } from './pipeline/agentic-pipeline';
import { FastPipeline } from './pipeline/fast-pipeline';

@Module({
  imports: [RagModule, ScannerModule, CacheModule],
  providers: [
    {
      provide: ChatOpenAI,
      useFactory: () =>
        new ChatOpenAI({
          model: 'gpt-4o-mini',
          temperature: 0,
          apiKey: process.env.OPENAI_API_KEY,
        }),
    },
    AnalysisResponseBuilder,
    AgenticPipeline,
    FastPipeline,
    AgentService,
  ],
  controllers: [AgentController],
})
export class AgentModule {}
