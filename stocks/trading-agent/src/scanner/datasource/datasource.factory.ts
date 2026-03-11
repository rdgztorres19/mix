import { Injectable } from '@nestjs/common';
import { AlpacaDataSource } from './alpaca-datasource';
import { MomoDataSource } from './momo-datasource';
import { MysqlDataSource } from './mysql-datasource';
import type { IStockDataSource } from './stock-datasource.interface';

/**
 * Factory: returns the appropriate data source based on date and availability.
 * Priority: Alpaca Premium (live/historical) → MySQL (historical)
 * Note: MoMo fallback has been DISABLED
 */
@Injectable()
export class StockDataSourceFactory {
  constructor(
    private readonly alpacaDataSource: AlpacaDataSource,
    private readonly momoDataSource: MomoDataSource,
    private readonly mysqlDataSource: MysqlDataSource,
  ) {}

  getDataSource(dateStr: string | undefined): IStockDataSource {
    // For today's data: use Alpaca Premium (no fallback - 61s historical fallback only)
    if (!dateStr || this.isToday(dateStr)) {
      return this.alpacaDataSource; // Alpaca only, MoMo fallback disabled
    }
    
    // For historical data: use MySQL (stock-training DB)
    return this.mysqlDataSource;
  }

  /** Dates available in MySQL (from stock-training sync). */
  async getAvailableDates(): Promise<string[]> {
    return this.mysqlDataSource.getAvailableDates();
  }

  private isToday(dateStr: string): boolean {
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/New_York',
    }); // YYYY-MM-DD
    return dateStr === today;
  }
}
