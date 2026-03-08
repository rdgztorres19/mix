/**
 * Change over N minutes feature.
 * Single responsibility: compute change_1m, change_5m, change_10m
 */

import type { Candle } from '../types';

export interface ChangeResult {
  change_1m: number | null;
  change_5m: number | null;
  change_10m: number | null;
}

export function computeChange(candles: Candle[], idx: number): ChangeResult {
  const closes = candles.map((c) => c.c);
  const closeT = closes[idx];
  if (closeT == null || closeT <= 0) {
    return { change_1m: null, change_5m: null, change_10m: null };
  }
  const change1m = idx >= 1 && closes[idx - 1] > 0
    ? (closeT - closes[idx - 1]) / closes[idx - 1]
    : null;
  const change5m = idx >= 5 && closes[idx - 5] > 0
    ? (closeT - closes[idx - 5]) / closes[idx - 5]
    : null;
  const change10m = idx >= 10 && closes[idx - 10] > 0
    ? (closeT - closes[idx - 10]) / closes[idx - 10]
    : null;
  return { change_1m: change1m, change_5m: change5m, change_10m: change10m };
}
