/**
 * Pre-market volume feature.
 * Single responsibility: sum volume of candles before 9:30 ET
 */

import type { Candle } from '../types';

function getEtTotalMinutes(isoTime: string): number {
  const d = new Date(isoTime);
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.getHours() * 60 + et.getMinutes();
}

export function computePremarketVolume(candles: Candle[]): number {
  let total = 0;

  for (const c of candles) {
    const totalMin = getEtTotalMinutes(c.t);
    if (totalMin < 9 * 60 + 30) {
      total += c.v;
    }
  }

  return total;
}