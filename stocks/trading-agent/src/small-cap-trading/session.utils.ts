/**
 * Session helpers for strategy matching.
 * getSession() returns "THE_OPEN (9:30-10:30am)" — we match by prefix.
 */
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
