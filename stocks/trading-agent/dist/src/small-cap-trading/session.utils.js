"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTheOpen = isTheOpen;
exports.isLateMorning = isLateMorning;
exports.isMidday = isMidday;
exports.isTheClose = isTheClose;
exports.isAfterHours = isAfterHours;
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