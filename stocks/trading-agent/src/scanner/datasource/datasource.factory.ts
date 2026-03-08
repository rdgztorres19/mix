import { Injectable } from '@nestjs/common';
import { MomoDataSource } from './momo-datasource';
import { MysqlDataSource } from './mysql-datasource';
import type { IStockDataSource } from './stock-datasource.interface';

/**
 * Factory: returns the appropriate data source based on date.
 * Today → MomoDataSource (live). Other dates → MysqlDataSource (historical from stock-training).
 */
@Injectable()
export class StockDataSourceFactory {
  constructor(
    private readonly momoDataSource: MomoDataSource,
    private readonly mysqlDataSource: MysqlDataSource,
  ) {}

  getDataSource(dateStr: string | undefined): IStockDataSource {
    if (!dateStr || this.isToday(dateStr)) return this.momoDataSource;
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
