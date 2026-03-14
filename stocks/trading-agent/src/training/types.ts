/**
 * TrainingCandle type - compatible with stock-training Candle.
 * Duplicated from stock-training/src/types.ts - keep in sync for consistent features
 */
export interface TrainingCandle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number; // timestamp ms
}
