import type { Candle } from '../types';
export interface VwapPoint {
    t: number;
    value: number;
}
export declare class VwapCalculator {
    static calculate(candles: Candle[]): number | null;
    static calculateLine(candles: Candle[]): VwapPoint[];
}
