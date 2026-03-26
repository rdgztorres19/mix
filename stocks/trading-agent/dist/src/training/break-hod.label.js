"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeTargetBreakHod5m = computeTargetBreakHod5m;
function computeTargetBreakHod5m(candles, idx, highOfDayUpToT) {
    if (idx + 5 >= candles.length)
        return null;
    let maxHigh = 0;
    for (let j = idx + 1; j <= idx + 5; j++) {
        if (candles[j]?.h > maxHigh)
            maxHigh = candles[j].h;
    }
    return maxHigh > highOfDayUpToT ? 1 : 0;
}
//# sourceMappingURL=break-hod.label.js.map