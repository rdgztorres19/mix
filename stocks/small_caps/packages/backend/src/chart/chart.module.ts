import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ChartController } from './chart.controller';
import { ChartService } from './chart.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ChartController],
  providers: [ChartService],
  exports: [ChartService],
})
export class ChartModule {}
