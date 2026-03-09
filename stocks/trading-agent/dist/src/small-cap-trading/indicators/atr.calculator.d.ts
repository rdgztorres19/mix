import type { Candle } from '../types';
export declare class AtrCalculator {
    static calculate(candles: Candle[], period?: number): number;
}
