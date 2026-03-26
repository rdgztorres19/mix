import { CollectorService } from './collector.service';
import { WebSocketInitService } from '../websocket/websocket-init.service';
import { PositionTrackerService } from '../trader/position-tracker.service';
import { CollectorFeaturePreviewService } from './collector-feature-preview.service';
import { CollectorFeaturesTodayDto } from './dto/collector-features-today.dto';
export declare class CollectorController {
    private readonly collector;
    private readonly featurePreview;
    private readonly webSocketInit;
    private readonly positionTracker;
    constructor(collector: CollectorService, featurePreview: CollectorFeaturePreviewService, webSocketInit: WebSocketInitService | null, positionTracker: PositionTrackerService | null);
    getTodayCandleFeatures(body: CollectorFeaturesTodayDto): Promise<{
        ok: boolean;
        date: string;
        results: Array<{
            symbol: string;
            candlesCount: number;
            metadata: unknown | null;
            rows: unknown[];
            candles?: unknown[];
            error?: string;
        }>;
        error?: string;
    }>;
    syncSymbolDate(body: {
        symbol: string;
        date: string;
    }): Promise<{
        ok: boolean;
        rows: number;
        error?: string;
    }>;
    syncDate(body: {
        date: string;
    }): Promise<{
        ok: boolean;
        symbols: number;
        totalRows: number;
        errors: string[];
    }>;
    syncToday(body: {
        source?: 'hpg' | 'alpaca_screener';
    }): Promise<{
        ok: boolean;
        symbols?: number;
        totalRows?: number;
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
