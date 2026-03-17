"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrbDetector = void 0;
class OrbDetector {
    detect(candles, atr) {
        const empty = { detected: false, name: 'ORB', anchor_points: [], description: '' };
        if (candles.length < 2)
            return empty;
        const firstCandle = this.findOpeningCandle(candles);
        if (!firstCandle)
            return empty;
        const rangeHigh = firstCandle.h;
        const rangeLow = firstCandle.l;
        const openingRange = rangeHigh - rangeLow;
        if (openingRange >= atr * 0.6)
            return empty;
        const lastCandle = candles[candles.length - 1];
        const breakoutUp = lastCandle.c > rangeHigh;
        const breakoutDown = lastCandle.c < rangeLow;
        if (!breakoutUp && !breakoutDown) {
            return {
                detected: true,
                name: 'ORB',
                anchor_points: [
                    { label: 'ORB_High', price: rangeHigh, time: firstCandle.t },
                    { label: 'ORB_Low', price: rangeLow, time: firstCandle.t },
                ],
                description: `ORB range: $${rangeLow.toFixed(2)}–$${rangeHigh.toFixed(2)} (${openingRange.toFixed(2)} range vs ${atr.toFixed(2)} ATR). No breakout yet.`,
            };
        }
        const direction = breakoutUp ? 'LONG' : 'SHORT';
        return {
            detected: true,
            name: 'ORB',
            anchor_points: [
                { label: 'ORB_High', price: rangeHigh, time: firstCandle.t },
                { label: 'ORB_Low', price: rangeLow, time: firstCandle.t },
                { label: `Breakout_${direction}`, price: lastCandle.c, time: lastCandle.t },
            ],
            description: `ORB ${direction} breakout: range $${rangeLow.toFixed(2)}–$${rangeHigh.toFixed(2)} (${openingRange.toFixed(2)} vs ATR ${atr.toFixed(2)})`,
        };
    }
    findOpeningCandle(candles) {
        for (const c of candles) {
            const d = new Date(c.t);
            const etStr = d.toLocaleTimeString('en-US', {
                timeZone: 'America/New_York',
                hour: 'numeric', minute: 'numeric', hour12: false,
            });
            const [h, m] = etStr.split(':').map(Number);
            const totalMin = h * 60 + m;
            if (totalMin >= 570 && totalMin <= 574)
                return c;
        }
        return null;
    }
}
exports.OrbDetector = OrbDetector;
//# sourceMappingURL=orb.detector.js.map