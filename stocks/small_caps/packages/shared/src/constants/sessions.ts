import type { SessionKey } from '../types/candle';

/** Session time boundaries in minutes from midnight ET. */
export const SESSION_BOUNDARIES: Record<SessionKey, { start: number; end: number }> = {
  PRE_MARKET: { start: 240, end: 570 },   // 4:00 - 9:30
  THE_OPEN: { start: 570, end: 660 },      // 9:30 - 11:00
  LATE_MORNING: { start: 660, end: 750 },  // 11:00 - 12:30
  MIDDAY: { start: 750, end: 840 },        // 12:30 - 14:00
  THE_CLOSE: { start: 840, end: 960 },     // 14:00 - 16:00
  AFTER_HOURS: { start: 960, end: 1200 },  // 16:00 - 20:00
};

export const MARKET_OPEN_MINUTE = 570; // 9:30 AM ET
export const MARKET_CLOSE_MINUTE = 960; // 4:00 PM ET

/** Get session key from minute of day (ET). */
export function getSessionFromMinute(minuteOfDay: number): string {
  if (minuteOfDay < 570) return 'PRE_MARKET';
  if (minuteOfDay < 660) return 'THE_OPEN';
  if (minuteOfDay < 750) return 'LATE_MORNING';
  if (minuteOfDay < 840) return 'MIDDAY';
  if (minuteOfDay < 960) return 'THE_CLOSE';
  return 'AFTER_HOURS';
}

/** Get session from a unix ms timestamp. */
export function getSessionFromTimestamp(ms: number): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return getSessionFromMinute(h * 60 + m);
}
