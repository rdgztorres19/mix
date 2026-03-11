import type { Candle, PatternResult } from '../types';
export declare class FallenAngelDetector {
    private readonly MIN_CANDLES;
    detect(candles: Candle[], preMarketHigh: number | null): PatternResult;
}
