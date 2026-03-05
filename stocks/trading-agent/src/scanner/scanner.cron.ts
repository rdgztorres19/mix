import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ScannerService, StockCandidate } from './scanner.service';

@Injectable()
export class ScannerCron {
  private readonly logger = new Logger(ScannerCron.name);

  // Cache the latest watchlist so the agent can access it
  private latestWatchlist: StockCandidate[] = [];
  private lastRun: Date | null = null;

  constructor(private readonly scannerService: ScannerService) {}

  /**
   * Runs every weekday at 8:00am ET (13:00 UTC).
   * Populates the daily watchlist before market open.
   */
  @Cron(process.env.SCANNER_CRON || '0 13 * * 1-5')
  async runDailyScanner(): Promise<void> {
    this.logger.log('⏰ Daily scanner cron triggered (8:00am ET)...');
    try {
      const candidates = await this.scannerService.runScanner();
      this.latestWatchlist = candidates;
      this.lastRun = new Date();
      this.logger.log(
        `✅ Daily watchlist ready: ${candidates.length} candidates. Tickers: ${candidates.map((c) => c.ticker).join(', ')}`,
      );
    } catch (err) {
      this.logger.error('Daily scanner cron failed:', err.message);
    }
  }

  /**
   * Also runs at 8:30am ET (13:30 UTC) for final pre-open refresh.
   */
  @Cron('30 13 * * 1-5')
  async runPreOpenRefresh(): Promise<void> {
    this.logger.log('🔄 Pre-open scanner refresh (8:30am ET)...');
    try {
      const candidates = await this.scannerService.runScanner();
      this.latestWatchlist = candidates;
      this.lastRun = new Date();
    } catch (err) {
      this.logger.error('Pre-open refresh failed:', err.message);
    }
  }

  getLatestWatchlist(): { candidates: StockCandidate[]; lastRun: Date | null } {
    return { candidates: this.latestWatchlist, lastRun: this.lastRun };
  }
}
