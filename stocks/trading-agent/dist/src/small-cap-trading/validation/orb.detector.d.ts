import type { Candle, PatternResult } from '../types';
export declare class OrbDetector {
    detect(candles: Candle[], atr: number): PatternResult;
    private findOpeningCandle;
}
