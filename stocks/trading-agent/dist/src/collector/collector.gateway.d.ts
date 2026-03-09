import { OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { CandleRow, CollectorCandle } from './indicator.calculator';
export interface CandleUpdatePayload {
    symbol: string;
    date: string;
    candle: {
        time: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
    };
    indicators: {
        vwap: number;
        ema9: number;
        ema20: number;
        atr: number;
        high_of_day: number;
        low_of_day: number;
    };
}
export declare class CollectorGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger;
    server: Server;
    afterInit(): void;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): void;
    emitCandleUpdate(row: CandleRow): void;
    emitCandleLive(symbol: string, candle: CollectorCandle): void;
    emitSymbolsUpdate(symbols: string[]): void;
}
