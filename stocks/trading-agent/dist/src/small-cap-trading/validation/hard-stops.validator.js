"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HardStopsValidator = void 0;
class HardStopsValidator {
    validate(ctx) {
        const failures = [];
        if (this.checkChangePct(ctx))
            failures.push(this.checkChangePct(ctx));
        if (this.checkRelativeVolume(ctx))
            failures.push(this.checkRelativeVolume(ctx));
        if (this.checkAtr(ctx))
            failures.push(this.checkAtr(ctx));
        if (this.checkSession(ctx))
            failures.push(this.checkSession(ctx));
        if (this.checkPriceMin(ctx))
            failures.push(this.checkPriceMin(ctx));
        if (this.checkPriceMax(ctx))
            failures.push(this.checkPriceMax(ctx));
        if (this.checkVwap(ctx))
            failures.push(this.checkVwap(ctx));
        return {
            passed: failures.length === 0,
            failures,
        };
    }
    checkChangePct(ctx) {
        if (ctx.change_pct < 0.05)
            return 'Change < 5%: not enough momentum';
        return null;
    }
    checkRelativeVolume(ctx) {
        if (ctx.relative_volume < 3)
            return 'Relative volume < 3x: insufficient interest';
        return null;
    }
    checkAtr(ctx) {
        if (ctx.atr < 0.30)
            return 'ATR < $0.30: price range too narrow';
        return null;
    }
    checkSession(ctx) {
        if (ctx.session === 'AFTER_HOURS' || ctx.session.startsWith('AFTER_HOURS'))
            return 'After hours: no live trading';
        return null;
    }
    checkPriceMin(ctx) {
        if (ctx.price < 1)
            return 'Price < $1: penny stock risk, skip';
        return null;
    }
    checkPriceMax(ctx) {
        if (ctx.price > 30)
            return 'Price > $30: outside low-float small cap zone';
        return null;
    }
    checkVwap(ctx) {
        if (!ctx.vwap)
            return 'VWAP unavailable: cannot assess directional bias';
        return null;
    }
}
exports.HardStopsValidator = HardStopsValidator;
//# sourceMappingURL=hard-stops.validator.js.map