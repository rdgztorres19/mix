import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ScreenerController } from './screener.controller';
import { ScreenerService } from './screener.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ScreenerController],
  providers: [ScreenerService],
})
export class ScreenerModule {}
