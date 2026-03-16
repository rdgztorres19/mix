// Duplicated from stock-training/src/labels/target.label.ts - keep in sync for consistent features
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
    get TARGET_THRESHOLD () {
        return TARGET_THRESHOLD;
    },
    get computeTarget () {
        return computeTarget;
    },
    get computeTargetMulticlass () {
        return computeTargetMulticlass;
    }
});
const TARGET_THRESHOLD = 0.025; // 2.5% — más estricto que 1.5% para reducir falsos positivos
function computeTarget(futureReturn5m) {
    if (futureReturn5m == null) return null;
    return futureReturn5m > TARGET_THRESHOLD ? 1 : 0;
}
function computeTargetMulticlass(futureReturn5m, threshold) {
    if (futureReturn5m == null) return null;
    if (futureReturn5m > threshold) return 1;
    if (futureReturn5m < -threshold) return -1;
    return 0;
}

//# sourceMappingURL=target.label.js.map