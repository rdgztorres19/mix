import { OnModuleInit } from '@nestjs/common';
import { MysqlTrainingRepository } from '../scanner/mysql/mysql-training.repository';
export interface AutoPosition {
    id: number;
    symbol: string;
    entry_time: string;
    entry_price: number;
    qty: number;
    entry_candle_idx: number;
    candles_elapsed: number;
    exit_time: string | null;
    exit_price: number | null;
    pnl: number | null;
    status: 'open' | 'closed';
    alpaca_order_id: string;
}
export declare class PositionTrackerService implements OnModuleInit {
    private readonly mysqlRepo;
    private readonly logger;
    private openPositions;
    constructor(mysqlRepo: MysqlTrainingRepository);
    onModuleInit(): Promise<void>;
    hasOpenPosition(symbol: string): boolean;
    getOpenPosition(symbol: string): AutoPosition | undefined;
    getAllOpen(): AutoPosition[];
    openPosition(symbol: string, entryPrice: number, qty: number, candleIdx: number, alpacaOrderId: string): Promise<AutoPosition>;
    incrementCandles(symbol: string): Promise<number>;
    closePosition(symbol: string, exitPrice: number): Promise<AutoPosition | null>;
    private ensureTable;
    private loadOpenPositions;
    private insertPositionRow;
    private updateColumn;
    private persistClose;
    private getPool;
    private nowMysql;
    private calculatePnl;
    private markClosed;
    private buildNewPosition;
    private rowToPosition;
}
