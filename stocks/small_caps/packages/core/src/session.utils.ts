/**
 * Session helpers for strategy matching.
 * Ported from trading-agent/src/small-cap-trading/session.utils.ts
 */
import { getSessionFromTimestamp as getFromTimestamp } from '@small-caps/shared';

export { getSessionFromMinute, getSessionFromTimestamp } from '@small-caps/shared';

export function isTheOpen(session: string): boolean {
  return session.startsWith('THE_OPEN');
}

export function isLateMorning(session: string): boolean {
  return session.startsWith('LATE_MORNING');
}

export function isMidday(session: string): boolean {
  return session.startsWith('MIDDAY');
}

export function isTheClose(session: string): boolean {
  return session.startsWith('THE_CLOSE');
}

export function isAfterHours(session: string): boolean {
  return session === 'AFTER_HOURS' || session.startsWith('AFTER_HOURS');
}
