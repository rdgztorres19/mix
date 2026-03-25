/** Helpers for America/New_York (NYSE session windows). */

export function getEtYYYYMMDD(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function isEtWeekday(d: Date = new Date()): boolean {
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(d);
  return wd !== 'Sat' && wd !== 'Sun';
}

export function getEtMinuteOfDay(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return hour * 60 + minute;
}

export function getEtHour(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(d);
  return parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
}

/** true if ET clock is in [09:00, 12:59] inclusive, any day (caller filters weekday). */
export function isEtMarketRankingWindow(d: Date = new Date()): boolean {
  const mod = getEtMinuteOfDay(d);
  const start = 9 * 60;
  const end = 12 * 60 + 59;
  return mod >= start && mod <= end;
}

/** Post-market extended hours cache window 16:00–20:59 ET (Alpaca often ~20:00). */
export function isEtPostMarketCacheWindow(d: Date = new Date()): boolean {
  const h = getEtHour(d);
  return h >= 16 && h <= 20;
}
