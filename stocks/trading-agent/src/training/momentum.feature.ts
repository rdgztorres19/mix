// Duplicated from stock-training/src/features/momentum.feature.ts - keep in sync for consistent features

export function computeMomentumAcumulado(close: number, openDay: number): number | null {
  if (openDay <= 0) return null;
  return (close - openDay) / openDay;
}
