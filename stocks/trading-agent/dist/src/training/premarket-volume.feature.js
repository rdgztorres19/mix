"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePremarketVolume = computePremarketVolume;
function computePremarketVolume(candles) {
    let total = 0;
    for (const c of candles) {
        const d = new Date(c.t);
        const etHour = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
        const etMin = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })).getMinutes();
        const totalMin = etHour * 60 + etMin;
        if (totalMin < 9 * 60 + 30)
            total += c.v;
    }
    return total;
}
//# sourceMappingURL=premarket-volume.feature.js.map