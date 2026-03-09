/**
 * CandleBuilder: aggregates individual trade ticks into 1-minute OHLCV candles.
 * Each symbol gets its own minute-bucket state.
 * When a new minute begins (or a flush timeout fires), the previous candle is emitted.
 */

import { Logger } from '@nestjs/common';
import type { CollectorCandle } from './indicator.calculator';

export type CandleCallback = (symbol: string, candle: CollectorCandle) => void;
export type TickCallback = (symbol: string, candle: CollectorCandle) => void;

interface MinuteState {
  minuteKey: number;  // floored to minute boundary (ms)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  size: number;       // accumulated size from Alpaca (shares in this candle)
}

const MINUTE_MS = 60_000;
const FLUSH_TIMEOUT_MS = 65_000; // close candle if no trades for >1 min

export class CandleBuilder {
  private readonly logger = new Logger(CandleBuilder.name);
  private readonly states = new Map<string, MinuteState>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly onCandle: CandleCallback;
  private readonly onTick?: TickCallback;

  constructor(onCandle: CandleCallback, onTick?: TickCallback) {
    this.onCandle = onCandle;
    this.onTick = onTick;
  }

  /**
   * Feed a trade tick into the builder.
   * @param symbol  e.g. "AAPL"
   * @param price   trade price
   * @param size    shares traded
   * @param tsMs    trade timestamp in unix ms
   */
  onTrade(symbol: string, price: number, size: number, tsMs: number): void {
    const minuteKey = Math.floor(tsMs / MINUTE_MS) * MINUTE_MS;
    const current = this.states.get(symbol);

    if (current && current.minuteKey !== minuteKey) {
      // New minute → finalize previous candle
      this.emitCandle(symbol, current);
      this.states.delete(symbol);
    }

    const state = this.states.get(symbol);
    if (!state) {
      // Start new candle
      this.states.set(symbol, {
        minuteKey,
        o: price,
        h: price,
        l: price,
        c: price,
        v: size,
        size,
      });
    } else {
      // Update existing candle
      if (price > state.h) state.h = price;
      if (price < state.l) state.l = price;
      state.c = price;
      state.v += size;
      state.size += size;
    }

    // Emit live tick with current in-progress candle
    if (this.onTick) {
      const s = this.states.get(symbol)!;
      this.onTick(symbol, { o: s.o, h: s.h, l: s.l, c: s.c, v: s.v, t: s.minuteKey });
    }

    // Reset flush timer
    this.resetFlushTimer(symbol);
  }

  /**
   * Force-close all open candles (e.g. on shutdown or disconnect).
   */
  flushAll(): void {
    for (const [symbol, state] of this.states) {
      this.emitCandle(symbol, state);
    }
    this.states.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /**
   * Force-close a specific symbol's candle.
   */
  flushSymbol(symbol: string): void {
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

  private emitCandle(symbol: string, state: MinuteState): void {
    if (state.v === 0) return; // skip empty candles
    const candle: CollectorCandle = {
      o: state.o,
      h: state.h,
      l: state.l,
      c: state.c,
      v: state.v,
      t: state.minuteKey,
    };
    try {
      this.onCandle(symbol, candle);
    } catch (err) {
      this.logger.error(`Candle callback error for ${symbol}: ${(err as Error).message}`);
    }
  }

  private resetFlushTimer(symbol: string): void {
    const existing = this.timers.get(symbol);
    if (existing) clearTimeout(existing);
    this.timers.set(
      symbol,
      setTimeout(() => {
        const state = this.states.get(symbol);
        if (state) {
          this.emitCandle(symbol, state);
          this.states.delete(symbol);
        }
        this.timers.delete(symbol);
      }, FLUSH_TIMEOUT_MS),
    );
  }
}
