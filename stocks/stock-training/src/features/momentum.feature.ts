/**
 * Momentum acumulado feature.
 * Single responsibility: (close - open_day) / open_day
 */

export function computeMomentumAcumulado(close: number, openDay: number): number | null {
  if (openDay <= 0) return null;
  return (close - openDay) / openDay;
}
