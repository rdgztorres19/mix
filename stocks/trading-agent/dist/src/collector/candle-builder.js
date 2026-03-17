"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CandleBuilder = void 0;
const common_1 = require("@nestjs/common");
const MINUTE_MS = 60_000;
const FLUSH_TIMEOUT_MS = 65_000;
class CandleBuilder {
    constructor(onCandle, onTick) {
        this.logger = new common_1.Logger(CandleBuilder.name);
        this.states = new Map();
        this.timers = new Map();
        this.onCandle = onCandle;
        this.onTick = onTick;
    }
    onTrade(symbol, price, size, tsMs) {
        const minuteKey = Math.floor(tsMs / MINUTE_MS) * MINUTE_MS;
        const current = this.states.get(symbol);
        if (current && current.minuteKey !== minuteKey) {
            this.emitCandle(symbol, current);
            this.states.delete(symbol);
        }
        const state = this.states.get(symbol);
        if (!state) {
            this.states.set(symbol, {
                minuteKey,
                o: price,
                h: price,
                l: price,
                c: price,
                v: size,
                size,
            });
        }
        else {
            if (price > state.h)
                state.h = price;
            if (price < state.l)
                state.l = price;
            state.c = price;
            state.v += size;
            state.size += size;
        }
        if (this.onTick) {
            const s = this.states.get(symbol);
            this.onTick(symbol, { o: s.o, h: s.h, l: s.l, c: s.c, v: s.v, t: s.minuteKey });
        }
        this.resetFlushTimer(symbol);
    }
    flushAll() {
        for (const [symbol, state] of this.states) {
            this.emitCandle(symbol, state);
        }
        this.states.clear();
        for (const timer of this.timers.values())
            clearTimeout(timer);
        this.timers.clear();
    }
    flushSymbol(symbol) {
        const state = this.states.get(symbol);
        if (state) {
            this.emitCandle(symbol, state);
            this.states.delete(symbol);
        }
        const timer = this.timers.get(symbol);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(symbol);
        }
    }
    emitCandle(symbol, state) {
        if (state.v === 0)
            return;
        const candle = {
            o: state.o,
            h: state.h,
            l: state.l,
            c: state.c,
            v: state.v,
            t: state.minuteKey,
        };
        try {
            this.onCandle(symbol, candle);
        }
        catch (err) {
            this.logger.error(`Candle callback error for ${symbol}: ${err.message}`);
        }
    }
    resetFlushTimer(symbol) {
        const existing = this.timers.get(symbol);
        if (existing)
            clearTimeout(existing);
        this.timers.set(symbol, setTimeout(() => {
            const state = this.states.get(symbol);
            if (state) {
                this.emitCandle(symbol, state);
                this.states.delete(symbol);
            }
            this.timers.delete(symbol);
        }, FLUSH_TIMEOUT_MS));
    }
}
exports.CandleBuilder = CandleBuilder;
//# sourceMappingURL=candle-builder.js.map