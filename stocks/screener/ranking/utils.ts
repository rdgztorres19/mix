import moment from 'moment-timezone';

export function getEasternNow(): moment.Moment {
  return moment().tz('America/New_York');
}

export function getEasternDateString(): string {
  return getEasternNow().format('YYYY-MM-DD');
}

export function getEasternTimeString(): string {
  return getEasternNow().format('HH:mm:ss');
}
