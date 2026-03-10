import { Controller, Post } from '@nestjs/common';
import { CollectorService } from './collector.service';

@Controller('collector')
export class CollectorController {
  constructor(private readonly collector: CollectorService) {}

  /**
   * POST /collector/sync-today
   * Triggers a MoMo refresh for today's candles (skips after hours).
   */
  @Post('sync-today')
  async syncToday(): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
    const result = await this.collector.refreshAllFromMomo({ force: true });
    return { ok: true, ...result };
  }
}
