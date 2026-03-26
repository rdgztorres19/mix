import { AlpacaDataSource } from './alpaca-datasource';
import { MomoDataSource } from './momo-datasource';
import { MysqlDataSource } from './mysql-datasource';
import type { IStockDataSource } from './stock-datasource.interface';
export declare class StockDataSourceFactory {
    private readonly alpacaDataSource;
    private readonly momoDataSource;
    private readonly mysqlDataSource;
    constructor(alpacaDataSource: AlpacaDataSource, momoDataSource: MomoDataSource, mysqlDataSource: MysqlDataSource);
    getDataSource(dateStr: string | undefined): IStockDataSource;
    getAvailableDates(): Promise<string[]>;
    private isToday;
}
