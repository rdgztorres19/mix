"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSession = getSession;
exports.getSessionFromTimestamp = getSessionFromTimestamp;
function getSession(etTime) {
    const [h, m] = etTime.split(':').map(Number);
    const totalMinutes = h * 60 + m;
    if (totalMinutes < 9 * 60 + 30)
        return 'PRE_MARKET';
    if (totalMinutes < 10 * 60 + 30)
        return 'THE_OPEN';
    if (totalMinutes < 12 * 60)
        return 'LATE_MORNING';
    if (totalMinutes < 15 * 60)
        return 'MIDDAY';
    if (totalMinutes < 16 * 60)
        return 'THE_CLOSE';
    return 'AFTER_HOURS';
}
function getSessionFromTimestamp(tsMs) {
    const date = new Date(tsMs);
    const etTime = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
    return getSession(etTime);
}
//# sourceMappingURL=session-utils.js.map