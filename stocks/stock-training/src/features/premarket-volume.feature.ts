/**
 * Pre-market volume feature.
 * Single responsibility: sum volume of candles before 9:30 ET
 */

import type { Candle } from '../types';

export function computePremarketVolume(candles: Candle[]): number {
  let total = 0;
  for (const c of candles) {
    const d = new Date(c.t);
    const etHour = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
    const etMin = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })).getMinutes();
    const totalMin = etHour * 60 + etMin;
    if (totalMin < 9 * 60 + 30) total += c.v;
  }
  return total;
}
