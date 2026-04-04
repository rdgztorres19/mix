import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { GzReaderService } from './gz-reader.service';
import { SyncWorkerService } from './sync-worker.service';

@Module({
  imports: [DatabaseModule],
  providers: [GzReaderService, SyncWorkerService],
  exports: [SyncWorkerService],
})
export class DataSyncModule {}
