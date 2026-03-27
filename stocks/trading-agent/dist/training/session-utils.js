// Duplicated from stock-training/src/session/session-utils.ts - keep in sync for consistent features
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get getSession () {
        return getSession;
    },
    get getSessionFromTimestamp () {
        return getSessionFromTimestamp;
    }
});
function getSession(etTime) {
    const [h, m] = etTime.split(':').map(Number);
    const totalMinutes = h * 60 + m;
    if (totalMinutes < 9 * 60 + 30) return 'PRE_MARKET';
    if (totalMinutes < 10 * 60 + 30) return 'THE_OPEN';
    if (totalMinutes < 12 * 60) return 'LATE_MORNING';
    if (totalMinutes < 15 * 60) return 'MIDDAY';
    if (totalMinutes < 16 * 60) return 'THE_CLOSE';
    return 'AFTER_HOURS';
}
function getSessionFromTimestamp(tsMs) {
    const date = new Date(tsMs);
    const etTime = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(date);
    return getSession(etTime);
}

//# sourceMappingURL=session-utils.js.map