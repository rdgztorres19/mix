"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEtYYYYMMDD = getEtYYYYMMDD;
exports.isEtWeekday = isEtWeekday;
exports.getEtMinuteOfDay = getEtMinuteOfDay;
exports.getEtHour = getEtHour;
exports.isEtMarketRankingWindow = isEtMarketRankingWindow;
exports.isEtPostMarketCacheWindow = isEtPostMarketCacheWindow;
function getEtYYYYMMDD(d = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}
function isEtWeekday(d = new Date()) {
    const wd = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
    }).format(d);
    return wd !== 'Sat' && wd !== 'Sun';
}
function getEtMinuteOfDay(d = new Date()) {
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
function getEtHour(d = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        hour12: false,
    }).formatToParts(d);
    return parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
}
function isEtMarketRankingWindow(d = new Date()) {
    const mod = getEtMinuteOfDay(d);
    const start = 9 * 60;
    const end = 12 * 60 + 59;
    return mod >= start && mod <= end;
}
function isEtPostMarketCacheWindow(d = new Date()) {
    const h = getEtHour(d);
    return h >= 16 && h <= 20;
}
//# sourceMappingURL=et-time.js.map