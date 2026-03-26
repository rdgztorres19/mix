import type { Candle, PatternResult } from '../types';
export declare class AbcdDetector {
    private readonly WINDOW;
    detect(candles: Candle[]): PatternResult;
    private findSwingHighs;
    private findSwingLows;
    private lastBefore;
}
