import { ConfigService } from '@nestjs/config';
import type { IWebSocketDataSource, RealTimeBar } from './websocket.interface';
export declare class AlpacaWebSocketService implements IWebSocketDataSource {
    private readonly configService;
    private readonly logger;
    private ws;
    private isAuthenticated;
    private subscriptions;
    private readonly barCallbacks;
    private readonly lastBarTimes;
    private readonly config;
    private readonly alpacaKeyId;
    private readonly alpacaSecretKey;
    private readonly wsUrl;
    constructor(configService: ConfigService);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    subscribe(symbols: string[]): Promise<void>;
    unsubscribe(symbols: string[]): Promise<void>;
    isConnected(): boolean;
    getLastBarTime(symbol: string): number | null;
    onBar(callback: (bar: RealTimeBar) => void): void;
    private handleOpen;
    private handleMessage;
    private handleAuthenticated;
    private handleBar;
    private handleClose;
    private handleError;
}
