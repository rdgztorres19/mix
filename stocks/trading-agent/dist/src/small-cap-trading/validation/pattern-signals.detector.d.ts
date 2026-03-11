import type { MarketContext, PatternResult } from '../types';
export interface PatternDetectionResult {
    signals: string[];
    bullFlagDetected: boolean;
    abcdDetected: boolean;
    orbDetected: boolean;
    vwapReversalDetected: boolean;
    fallenAngelDetected: boolean;
    patterns: PatternResult[];
}
export declare class PatternSignalsDetector {
    private readonly bullFlag;
    private readonly abcd;
    private readonly orb;
    private readonly vwapReversal;
    private readonly fallenAngel;
    private readonly technical;
    detect(ctx: MarketContext): PatternDetectionResult;
}
