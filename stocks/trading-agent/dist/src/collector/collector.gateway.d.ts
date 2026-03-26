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
    debug?: {
        originalTimestampMs?: number;
        etString?: string;
    };
}
export declare class CollectorGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger;
    private connectedClients;
    server: Server;
    afterInit(): void;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): void;
    emitCandleUpdate(row: CandleRow): void;
    emitCandleLive(symbol: string, candle: CollectorCandle): void;
    emitSymbolsUpdate(symbols: string[]): void;
    getConnectionInfo(): {
        connectedClients: number;
        clientIds: string[];
        namespace: string;
    };
    emitPredictSignal(payload: {
        symbol: string;
        date: string;
        time: string;
        prob: number;
        threshold: number;
        tradeable: boolean;
        close: number;
    }): void;
    emitTradeEntry(payload: {
        symbol: string;
        date: string;
        time: string;
        price: number;
        qty: number;
        dollarAmount: number;
        orderId: string;
    }): void;
    emitTradeExit(payload: {
        symbol: string;
        date: string;
        time: string;
        entryPrice: number;
        exitPrice: number;
        qty: number;
        pnl: number;
        candlesHeld: number;
    }): void;
}
