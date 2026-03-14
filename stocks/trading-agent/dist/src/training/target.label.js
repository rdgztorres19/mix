"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TARGET_THRESHOLD = void 0;
exports.computeTarget = computeTarget;
exports.computeTargetMulticlass = computeTargetMulticlass;
exports.TARGET_THRESHOLD = 0.025;
function computeTarget(futureReturn5m) {
    if (futureReturn5m == null)
        return null;
    return futureReturn5m > exports.TARGET_THRESHOLD ? 1 : 0;
}
function computeTargetMulticlass(futureReturn5m, threshold) {
    if (futureReturn5m == null)
        return null;
    if (futureReturn5m > threshold)
        return 1;
    if (futureReturn5m < -threshold)
        return -1;
    return 0;
}
//# sourceMappingURL=target.label.js.map