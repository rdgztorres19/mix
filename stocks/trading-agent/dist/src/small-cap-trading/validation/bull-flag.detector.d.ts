import type { Candle, PatternResult } from '../types';
export declare class BullFlagDetector {
    private readonly WINDOW;
    private readonly MIN_POLE;
    private readonly MIN_FLAG;
    private readonly MAX_RETRACE_PCT;
    detect(candles: Candle[]): PatternResult;
    private scanWindow;
    private isValidPole;
    private isValidFlag;
}
