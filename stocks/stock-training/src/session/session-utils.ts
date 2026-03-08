/**
 * Session classification (ET timezone).
 * 4:00 AM = pre-market start, 9:30 AM = market open, 4:00 PM = market close.
 */
export type Session =
  | 'PRE_MARKET'
  | 'THE_OPEN'
  | 'LATE_MORNING'
  | 'MIDDAY'
  | 'THE_CLOSE'
  | 'AFTER_HOURS';

export function getSession(etTime: string): Session {
  const [h, m] = etTime.split(':').map(Number);
  const totalMinutes = h * 60 + m;

  if (totalMinutes < 9 * 60 + 30) return 'PRE_MARKET';
  if (totalMinutes < 10 * 60 + 30) return 'THE_OPEN';
  if (totalMinutes < 12 * 60) return 'LATE_MORNING';
  if (totalMinutes < 15 * 60) return 'MIDDAY';
  if (totalMinutes < 16 * 60) return 'THE_CLOSE';
  return 'AFTER_HOURS';
}

export function getSessionFromTimestamp(tsMs: number): Session {
  const date = new Date(tsMs);
  const etTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return getSession(etTime);
}
