import { CollectorService } from './collector.service';
export declare class CollectorController {
    private readonly collector;
    constructor(collector: CollectorService);
    syncToday(): Promise<{
        ok: boolean;
        skipped?: boolean;
        reason?: string;
    }>;
    getStatus(): Promise<{
        activeSymbols: string[];
        subscribedSymbols: string[];
        wsConnected: boolean;
        symbolCount: number;
    }>;
    forceResync(): Promise<{
        ok: boolean;
        resubscribed: string[];
    }>;
    testScan(): Promise<{
        ok: boolean;
        newSymbols: string[];
    }>;
    getWebSocketStats(): Promise<{
        symbolTicks: {
            [k: string]: number;
        };
        lastTickTime: string;
        messagesReceived: number;
        ticksProcessed: number;
        ticksFiltered: number;
    }>;
    getStreamStatus(): Promise<{
        alpaca: {
            connected: boolean;
            subscriptions: string[];
            source: string;
        };
        momo: {
            connected: boolean;
            subscriptions: string[];
            source: string;
        };
        activeSymbols: string[];
        primaryStream: string;
    }>;
}
