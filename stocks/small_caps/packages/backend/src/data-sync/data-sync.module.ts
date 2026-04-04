import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { GzReaderService } from './gz-reader.service';
import { ProfileReaderService } from './profile-reader.service';
import { SyncWorkerService } from './sync-worker.service';

@Module({
  imports: [DatabaseModule],
  providers: [GzReaderService, ProfileReaderService, SyncWorkerService],
  exports: [SyncWorkerService],
})
export class DataSyncModule {}
