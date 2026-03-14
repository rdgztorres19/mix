import { OnModuleDestroy } from '@nestjs/common';
import { CandleCallback, TickCallback } from './candle-builder';
export declare class AlpacaStreamService implements OnModuleDestroy {
    private readonly logger;
    private ws;
    private authenticated;
    private reconnectAttempt;
    private reconnectTimer;
    private subscribedSymbols;
    private candleBuilder;
    private destroyed;
    private readonly apiKey;
    private readonly apiSecret;
    constructor();
    init(onCandle: CandleCallback, onTick?: TickCallback): Promise<void>;
    subscribe(symbols: string[]): void;
    unsubscribe(symbols: string[]): void;
    getSubscribedSymbols(): string[];
    onModuleDestroy(): void;
    private connect;
    private sendSubscribe;
    private scheduleReconnect;
}
