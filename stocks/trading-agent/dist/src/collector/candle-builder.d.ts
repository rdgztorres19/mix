import type { CollectorCandle } from './indicator.calculator';
export type CandleCallback = (symbol: string, candle: CollectorCandle) => void;
export type TickCallback = (symbol: string, candle: CollectorCandle) => void;
export declare class CandleBuilder {
    private readonly logger;
    private readonly states;
    private readonly timers;
    private readonly onCandle;
    private readonly onTick?;
    constructor(onCandle: CandleCallback, onTick?: TickCallback);
    onTrade(symbol: string, price: number, size: number, tsMs: number): void;
    flushAll(): void;
    flushSymbol(symbol: string): void;
    private emitCandle;
    private resetFlushTimer;
}
