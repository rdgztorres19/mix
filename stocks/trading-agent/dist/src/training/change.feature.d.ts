import type { TrainingCandle } from './types';
export interface ChangeResult {
    change_1m: number | null;
    change_5m: number | null;
    change_10m: number | null;
}
export declare function computeChange(candles: TrainingCandle[], idx: number): ChangeResult;
