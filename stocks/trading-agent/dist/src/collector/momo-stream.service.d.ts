import { OnModuleDestroy } from '@nestjs/common';
import { CandleCallback, TickCallback } from './candle-builder';
export declare class MomoStreamService implements OnModuleDestroy {
    private readonly logger;
    private readonly enabled;
    private ws;
    private connected;
    private reconnectAttempt;
    private reconnectTimer;
    private pingTimer;
    private subscribedSymbols;
    private candleBuilder;
    private destroyed;
    private stats;
    constructor();
    init(onCandle: CandleCallback, onTick?: TickCallback): Promise<void>;
    subscribe(symbols: string[]): void;
    unsubscribe(symbols: string[]): void;
    getSubscribedSymbols(): string[];
    isConnected(): boolean;
    getStats(): {
        symbolTicks: {
            [k: string]: number;
        };
        lastTickTime: string;
        messagesReceived: number;
        ticksProcessed: number;
        ticksFiltered: number;
    };
    resetStats(): void;
    onModuleDestroy(): void;
    private cleanup;
    private connect;
    private handleEvent;
    private processQuote;
    private sendSubscribe;
    private scheduleReconnect;
}
