/**
 * Post-prediction trade filters.
 * Applied AFTER model predicts but BEFORE trade is evaluated.
 * Each filter can be enabled/disabled independently.
 */

import type { CollectorCandle } from '../../collector/indicator.calculator';
import { timestampToET } from '../../collector/indicator.calculator';

// ── ETF / Leveraged / Inverse blacklist ──────────────────────────────────────
// These have poor momentum prediction — model wasn't trained on ETF patterns
const ETF_BLACKLIST = new Set([
  // Leveraged / Inverse ETFs
  'SOXL', 'SOXS', 'TQQQ', 'SQQQ', 'SPXL', 'SPXS', 'SPXU', 'SDOW',
  'UVXY', 'UVIX', 'SVIX', 'VIXY', 'VXX',
  'TECS', 'TECL', 'LABD', 'LABU',
  'TZA', 'TNA', 'FAS', 'FAZ',
  'DUST', 'NUGT', 'JNUG', 'JDST',
  'MSTU', 'MSTZ', 'TSDD', 'TSLQ', 'TSLZ',
  // Commodity ETFs
  'AGQ', 'ZSL', 'UGL', 'GLD', 'SLV', 'GDX', 'GDXU', 'GDXD',
  'USO', 'UCO', 'SCO', 'UNG', 'BOIL', 'KOLD',
  'BNO',
  // Country / Sector leveraged
  'EWY', 'KORU', 'YINN', 'YANG',
  // Crypto ETFs
  'ETHU', 'BTCZ', 'SBIT', 'BITO',
  // Other leveraged/inverse
  'PLTD', 'BMNU', 'BMNG',
]);

export interface TradeContext {
  symbol: string;
  prob: number;
  price: number;              // current close
  gapPct: number;             // gap % from prev close
  atrPct: number;             // ATR as % of price
  sharesOutstanding: number;
  floatRotation: number;      // cumulative vol / shares outstanding
  rvol: number;               // relative volume (current / avg 20)
  premarketVolume: number;
  minuteOfDay: number;        // e.g. 570 = 09:30
  distHodPct: number;         // distance from HOD as % (negative = below)
  maxDayGainPct: number;      // max gain of the day so far
  history: CollectorCandle[];
}

export interface FilterConfig {
  enabled: boolean;
  name: string;
  fn: (ctx: TradeContext) => boolean; // true = pass, false = reject
}

// ── Individual filters ───────────────────────────────────────────────────────

export const FILTERS: Record<string, FilterConfig> = {
  // ETF / Leveraged / Inverse blacklist — model doesn't predict these well
  noETF: {
    enabled: false,
    name: 'No ETF/Leveraged',
    fn: (ctx) => !ETF_BLACKLIST.has(ctx.symbol),
  },

  // Price range: $3-50 optimal (70-73% WR)
  priceRange: {
    enabled: false,
    name: 'Price $3-50',
    fn: (ctx) => ctx.price >= 3 && ctx.price <= 50,
  },

  maxPrice5: {
    enabled: true,
    name: 'Price <= $5',
    fn: (ctx) => ctx.price <= 5,
  },

  // Gap > 30% already moved too much
  noHugeGap: {
    enabled: false,
    name: 'Gap < 30%',
    fn: (ctx) => ctx.gapPct < 30,
  },

  // Price > $50 poor WR (63%)
  noExpensive: {
    enabled: false,
    name: 'Price < $50',
    fn: (ctx) => ctx.price < 50,
  },

  // Gap: 0-5% best (71.3% WR), avoid >10% (53-62% WR)
  gapRange: {
    enabled: false,
    name: 'Gap 0-10%',
    fn: (ctx) => ctx.gapPct >= -2 && ctx.gapPct <= 10,
  },

  // RVOL: 1-2x best (71.8% WR), extreme RVOL worse
  rvolRange: {
    enabled: false,  // disabled by default — needs more testing
    name: 'RVOL < 5x',
    fn: (ctx) => ctx.rvol < 5,
  },

  // Premarket volume: <100K best (72.3% WR)
  premarketVol: {
    enabled: false,  // disabled — many good stocks have high premarket vol
    name: 'PreMkt Vol < 500K',
    fn: (ctx) => ctx.premarketVolume < 500_000,
  },

  // Time of day: 09:35-11:00 best, avoid first 5 min
  timeOfDay: {
    enabled: false,
    name: 'Time 09:35-11:30',
    fn: (ctx) => ctx.minuteOfDay >= 575 && ctx.minuteOfDay <= 690,
  },

  // Distance from HOD: -10% to 0% best (70-72% WR)
  distFromHod: {
    enabled: false,
    name: 'Dist HOD > -15%',
    fn: (ctx) => ctx.distHodPct > -15,
  },

  // Float: 5M-500M optimal (68-73% WR)
  floatRange: {
    enabled: false,  // disabled — not always available
    name: 'Float 5M-500M',
    fn: (ctx) => ctx.sharesOutstanding >= 5_000_000 && ctx.sharesOutstanding <= 500_000_000,
  },

  // Minimum probability: raise threshold from 0.65 to 0.70+
  minProb: {
    enabled: false,
    name: 'Prob >= 0.70',
    fn: (ctx) => ctx.prob >= 0.70,
  },

  // Max signals per stock per day (avoid SYNX with 26 signals)
  // This is handled separately in main.ts, not here
};

// ── Apply all enabled filters ────────────────────────────────────────────────

export function applyFilters(ctx: TradeContext): { pass: boolean; rejectedBy?: string } {
  for (const [key, filter] of Object.entries(FILTERS)) {
    if (filter.enabled && !filter.fn(ctx)) {
      return { pass: false, rejectedBy: filter.name };
    }
  }
  return { pass: true };
}

// ── Build context from candle data ───────────────────────────────────────────

export function buildTradeContext(
  symbol: string,
  prob: number,
  history: CollectorCandle[],
  prevClose: number,
  sharesOutstanding: number,
  premarketVolume: number,
  gapPct: number,
): TradeContext {
  const last = history[history.length - 1];
  const price = last.c;

  // ATR % (simple: avg range of last 14 candles / price)
  const atrWindow = history.slice(-14);
  const avgRange = atrWindow.reduce((s, c) => s + (c.h - c.l), 0) / atrWindow.length;
  const atrPct = price > 0 ? (avgRange / price) * 100 : 0;

  // Float rotation
  const cumVol = history.reduce((s, c) => s + c.v, 0);
  const floatRotation = sharesOutstanding > 0 ? cumVol / sharesOutstanding : 0;

  // Relative volume (last candle vs avg of previous 20)
  let rvol = 1;
  if (history.length > 20) {
    const avg20 = history.slice(-21, -1).reduce((s, c) => s + c.v, 0) / 20;
    rvol = avg20 > 0 ? last.v / avg20 : 1;
  }

  // Minute of day
  const { minuteOfDay } = timestampToET(last.t);

  // HOD and distance
  let hod = -Infinity;
  for (const c of history) {
    if (c.h > hod) hod = c.h;
  }
  const distHodPct = hod > 0 ? ((price - hod) / hod) * 100 : 0;

  // Max day gain (from first candle open)
  const dayOpen = history[0].o;
  const maxDayGainPct = dayOpen > 0 ? ((hod - dayOpen) / dayOpen) * 100 : 0;

  return {
    symbol, prob, price, gapPct, atrPct,
    sharesOutstanding, floatRotation, rvol,
    premarketVolume, minuteOfDay, distHodPct, maxDayGainPct,
    history,
  };
}
