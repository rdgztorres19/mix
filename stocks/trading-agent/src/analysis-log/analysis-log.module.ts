import { Module, Global } from '@nestjs/common';
import { AnalysisLogService } from './analysis-log.service';

@Global()
@Module({
  providers: [AnalysisLogService],
  exports: [AnalysisLogService],
})
export class AnalysisLogModule {}
