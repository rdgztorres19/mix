import { ConfigService } from '@nestjs/config';
import { AlpacaWebSocketService } from './alpaca-websocket.service';
import { AlpacaDataSource } from '../scanner/datasource/alpaca-datasource';
import type { CollectorService } from '../collector/collector.service';
export declare class WebSocketFallbackCron {
    private readonly configService;
    private readonly alpacaWebSocket;
    private readonly alpacaDataSource;
    private readonly collector?;
    private readonly logger;
    private readonly enabled;
    private readonly symbols;
    private readonly checkIntervalSeconds;
    constructor(configService: ConfigService, alpacaWebSocket: AlpacaWebSocketService, alpacaDataSource: AlpacaDataSource, collector?: CollectorService);
    checkWebSocketHealth(): Promise<void>;
    private checkSymbolData;
    private fetchFallbackData;
    private getExpectedBarTime;
    triggerFallbackCheck(): Promise<void>;
}
declare module '../scanner/datasource/alpaca-datasource' {
    interface AlpacaDataSource {
        fetchBarsFromAlpacaDirect(params: {
            symbol: string;
            timeframe: string;
            start: string;
            end: string;
            feed: string;
            limit: number;
        }): Promise<any>;
    }
}
