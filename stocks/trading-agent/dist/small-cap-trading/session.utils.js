/**
 * Session helpers for strategy matching.
 * getSession() returns "THE_OPEN (9:30-10:30am)" — we match by prefix.
 */ "use strict";
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
    get isAfterHours () {
        return isAfterHours;
    },
    get isLateMorning () {
        return isLateMorning;
    },
    get isMidday () {
        return isMidday;
    },
    get isTheClose () {
        return isTheClose;
    },
    get isTheOpen () {
        return isTheOpen;
    }
});
function isTheOpen(session) {
    return session.startsWith('THE_OPEN');
}
function isLateMorning(session) {
    return session.startsWith('LATE_MORNING');
}
function isMidday(session) {
    return session.startsWith('MIDDAY');
}
function isTheClose(session) {
    return session.startsWith('THE_CLOSE');
}
function isAfterHours(session) {
    return session === 'AFTER_HOURS' || session.startsWith('AFTER_HOURS');
}

//# sourceMappingURL=session.utils.js.map