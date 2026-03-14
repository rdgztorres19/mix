import type { Candle, PatternResult } from '../types';
export declare class VwapReversalDetector {
    private readonly MIN_CANDLES;
    detect(candles: Candle[], vwap: number | null): PatternResult;
    private detectBullishReversal;
    private detectBearishReversal;
}
