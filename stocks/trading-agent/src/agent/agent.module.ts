import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { RagModule } from '../rag/rag.module';
import { ScannerModule } from '../scanner/scanner.module';

@Module({
  imports: [RagModule, ScannerModule],
  providers: [AgentService],
  controllers: [AgentController],
})
export class AgentModule {}
