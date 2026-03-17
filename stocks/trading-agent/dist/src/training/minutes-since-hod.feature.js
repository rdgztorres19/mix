"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeMinutesSinceHod = computeMinutesSinceHod;
function computeMinutesSinceHod(candles, idx, highOfDayUpToT) {
    let lastHodIdx = -1;
    for (let j = idx; j >= 0; j--) {
        if (candles[j]?.h >= highOfDayUpToT - 1e-10) {
            lastHodIdx = j;
            break;
        }
    }
    if (lastHodIdx < 0)
        return null;
    return idx - lastHodIdx;
}
//# sourceMappingURL=minutes-since-hod.feature.js.map