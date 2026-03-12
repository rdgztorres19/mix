import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AlpacaWebSocketService } from './alpaca-websocket.service';
import { CollectorService } from '../collector/collector.service';
export declare class WebSocketInitService implements OnModuleInit, OnModuleDestroy {
    private readonly alpacaWebSocket;
    private readonly collector;
    private readonly logger;
    constructor(alpacaWebSocket: AlpacaWebSocketService, collector: CollectorService);
    onModuleInit(): Promise<void>;
    subscribeToSymbols(symbols: string[]): Promise<void>;
    unsubscribeFromSymbols(symbols: string[]): Promise<void>;
    isAlpacaConnected(): boolean;
    getAlpacaSubscriptions(): string[];
    getLastBarTimesMap(): Record<string, number>;
    refreshSubscriptions(activeSymbols: string[]): Promise<void>;
    onModuleDestroy(): Promise<void>;
}
