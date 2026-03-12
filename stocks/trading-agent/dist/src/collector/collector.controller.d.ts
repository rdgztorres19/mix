import { CollectorService } from './collector.service';
import { WebSocketInitService } from '../websocket/websocket-init.service';
import { PositionTrackerService } from '../trader/position-tracker.service';
export declare class CollectorController {
    private readonly collector;
    private readonly webSocketInit;
    private readonly positionTracker;
    constructor(collector: CollectorService, webSocketInit: WebSocketInitService | null, positionTracker: PositionTrackerService | null);
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
        positions: Array<{
            id: number;
            symbol: string;
            entry_time: string;
            entry_price: number;
            qty: number;
            entry_candle_idx: number;
            candles_elapsed: number;
            alpaca_order_id: string;
        }>;
        lastBarTimes: Record<string, number>;
    }>;
}
