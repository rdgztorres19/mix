#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

const CONFIG = {
  inputFile: process.argv[2] || "../stock-training/data/backups/training.csv",
  outputDir: ".",

  // Horarios ET
  premarketStartMinutes: 4 * 60,
  marketOpenMinutes: 9 * 60 + 30,
  cutoffMinutes: 12 * 60,

  // Particionado
  bucketCount: 128,
  tmpRootDir: path.join(os.tmpdir(), "momentum-stockday-buckets-v3"),

  // Cooldowns
  buyCooldownMinutes: 8,
  sellCooldownMinutes: 10,

  // Label por percentiles
  trueMomentumScoreQuantile: 0.8,
  eliteMomentumScoreQuantile: 0.9,

  // Búsqueda de reglas
  quantiles: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],

  minSamplesSingle: 40,
  minSamplesPair: 30,
  minSamplesTriple: 20,
  minSamplesQuad: 15,

  topSingle: 40,
  topPair: 40,
  topTriple: 30,
  topQuad: 20,

  topSeedSingles: 18,

  // Filtros realistas
  minPositiveRate: 0.22,
  maxNegativeRate: 0.82,
  minLift: 0.03,

  rejectNARules: true,
};

const LEADING_COLUMNS = [
  "symbol",
  "date",
  "candle_time_et",
  "candle_idx",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "atr",
  "vwap",
  "high_of_day",
  "low_of_day",
  "change_pct_at_candle",
  "ema9",
  "ema20",
  "pre_market_high",
  "session",
  "shares_outstanding",
  "market_cap",
  "gap_pct",
  "premarket_volume",
  "momentum_acumulado",
  "change_1m",
  "change_5m",
  "change_10m",
  "minutes_since_hod",
];

const NUMERIC_FIELDS = [
  "candle_idx",
  "open",
  "high",
  "low",
  "close",
  "volume",
  "atr",
  "vwap",
  "high_of_day",
  "low_of_day",
  "change_pct_at_candle",
  "ema9",
  "ema20",
  "pre_market_high",
  "shares_outstanding",
  "market_cap",
  "gap_pct",
  "premarket_volume",
  "momentum_acumulado",
  "change_1m",
  "change_5m",
  "change_10m",
  "minutes_since_hod",
];

// SOLO features disponibles al momento del baseRow o antes
const RULE_FEATURES_NUMERIC = [
  "gap_pct",
  "premarket_volume",
  "premarket_dollar_volume",
  "pm_range_pct",
  "pm_close_vs_high_pct",
  "pm_close_vs_open_pct",
  "change_pct_at_candle",
  "change_5m",
  "change_10m",
  "minutes_since_hod",
  "distance_to_hod_pct",
  "distance_to_pm_high_pct",
  "distance_to_vwap_pct",
  "ema_spread_pct",
  "extension_vs_atr",
  "dollar_volume",
  "open_to_base_pct",
  "base_range_pct",
  "pm_to_open_gap_pct",
  "pm_to_base_ret_pct",
  "atr_pct",
  "volume_vs_premarket_volume",
];

const RULE_FEATURES_CATEGORICAL = [
  "session",
  "close_gt_vwap",
  "ema9_gt_ema20",
  "close_gt_ema9",
  "close_gt_ema20",
  "base_in_open_window",
];

const MANUAL_RULES = [
  {
    name: "true_breakout_candidate",
    conditions: [
      { feature: "distance_to_hod_pct", type: "lte", value: 0.05 },
      { feature: "close_gt_vwap", type: "eq", value: "1" },
      { feature: "ema9_gt_ema20", type: "eq", value: "1" },
      { feature: "dollar_volume", type: "gte", value: 100000 },
    ],
  },
  {
    name: "controlled_pullback_near_high",
    conditions: [
      { feature: "change_5m", type: "between", min: -0.06, max: -0.01 },
      { feature: "distance_to_hod_pct", type: "lte", value: 0.08 },
      { feature: "close_gt_vwap", type: "eq", value: "1" },
      { feature: "base_in_open_window", type: "eq", value: "1" },
    ],
  },
  {
    name: "clean_open_strength",
    conditions: [
      { feature: "base_in_open_window", type: "eq", value: "1" },
      { feature: "close_gt_vwap", type: "eq", value: "1" },
      { feature: "distance_to_pm_high_pct", type: "lte", value: 0.15 },
      { feature: "open_to_base_pct", type: "between", min: -0.03, max: 0.20 },
    ],
  },
  {
    name: "moderate_pm_liquidity",
    conditions: [
      { feature: "premarket_dollar_volume", type: "between", min: 50000, max: 2000000 },
      { feature: "gap_pct", type: "between", min: 0.05, max: 2.5 },
      { feature: "distance_to_pm_high_pct", type: "lte", value: 0.20 },
    ],
  },
  {
    name: "trend_not_overextended",
    conditions: [
      { feature: "ema9_gt_ema20", type: "eq", value: "1" },
      { feature: "close_gt_ema9", type: "eq", value: "1" },
      { feature: "extension_vs_atr", type: "between", min: -0.75, max: 1.25 },
      { feature: "distance_to_vwap_pct", type: "gte", value: -0.03 },
    ],
  },
];

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function detectDelimiter(line) {
  const commaCount = (line.match(/,/g) || []).length;
  const tabCount = (line.match(/\t/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

function toNum(v) {
  if (v === undefined || v === null) return NaN;
  const s = String(v).trim();
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function round(n, digits = 6) {
  if (!Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function safeDiv(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return NaN;
  return a / b;
}

function mean(arr) {
  const vals = arr.filter(Number.isFinite);
  if (!vals.length) return NaN;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function maxFinite(arr) {
  const vals = arr.filter(Number.isFinite);
  return vals.length ? Math.max(...vals) : NaN;
}

function minFinite(arr) {
  const vals = arr.filter(Number.isFinite);
  return vals.length ? Math.min(...vals) : NaN;
}

function percentile(sortedArr, q) {
  if (!sortedArr.length) return NaN;
  if (q <= 0) return sortedArr[0];
  if (q >= 1) return sortedArr[sortedArr.length - 1];
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = sortedArr[base];
  const upper = sortedArr[base + 1] ?? lower;
  return lower + rest * (upper - lower);
}

function uniqueSorted(arr) {
  return [...new Set(arr.filter(Number.isFinite).map(x => round(x, 10)))].sort((a, b) => a - b);
}

function formatPct(x) {
  if (!Number.isFinite(x)) return "n/a";
  return `${(x * 100).toFixed(2)}%`;
}

function parseTimeToMinutes(s) {
  if (!s) return NaN;
  const parts = String(s).trim().split(":");
  if (parts.length < 2) return NaN;
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  return hh * 60 + mm;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function writeJson(name, data) {
  fs.writeFileSync(path.join(CONFIG.outputDir, name), JSON.stringify(data, null, 2));
}

function parseRowFromParts(parts) {
  if (parts.length < 15) return null;

  const row = {};
  for (let c = 0; c < LEADING_COLUMNS.length; c++) {
    row[LEADING_COLUMNS[c]] = parts[c] ?? "";
  }

  for (const f of NUMERIC_FIELDS) row[f] = toNum(row[f]);

  row.symbol = String(row.symbol || "").trim();
  row.date = String(row.date || "").trim();
  row.candle_time_et = String(row.candle_time_et || "").trim();
  row.session = String(row.session || "").trim();
  row.time_minutes = parseTimeToMinutes(row.candle_time_et);

  if (!row.symbol || !row.date) return null;
  if (!Number.isFinite(row.time_minutes)) return null;
  if (!Number.isFinite(row.close) || row.close <= 0) return null;
  if (!Number.isFinite(row.high) || !Number.isFinite(row.low)) return null;

  row.dollar_volume =
    Number.isFinite(row.close) && Number.isFinite(row.volume)
      ? row.close * row.volume
      : NaN;

  row.premarket_dollar_volume =
    Number.isFinite(row.close) && Number.isFinite(row.premarket_volume)
      ? row.close * row.premarket_volume
      : NaN;

  row.distance_to_hod_pct =
    Number.isFinite(row.high_of_day) && Number.isFinite(row.close) && row.close !== 0
      ? (row.high_of_day - row.close) / row.close
      : NaN;

  row.distance_to_pm_high_pct =
    Number.isFinite(row.pre_market_high) && Number.isFinite(row.close) && row.close !== 0
      ? (row.pre_market_high - row.close) / row.close
      : NaN;

  row.distance_to_vwap_pct =
    Number.isFinite(row.vwap) && row.vwap !== 0 && Number.isFinite(row.close)
      ? (row.close - row.vwap) / row.vwap
      : NaN;

  row.ema_spread_pct =
    Number.isFinite(row.ema9) && Number.isFinite(row.ema20) && row.ema20 !== 0
      ? (row.ema9 - row.ema20) / row.ema20
      : NaN;

  row.extension_vs_atr =
    Number.isFinite(row.close) &&
    Number.isFinite(row.ema9) &&
    Number.isFinite(row.atr) &&
    row.atr !== 0
      ? (row.close - row.ema9) / row.atr
      : NaN;

  row.close_gt_vwap =
    Number.isFinite(row.close) && Number.isFinite(row.vwap)
      ? (row.close > row.vwap ? "1" : "0")
      : "NA";

  row.ema9_gt_ema20 =
    Number.isFinite(row.ema9) && Number.isFinite(row.ema20)
      ? (row.ema9 > row.ema20 ? "1" : "0")
      : "NA";

  row.close_gt_ema9 =
    Number.isFinite(row.close) && Number.isFinite(row.ema9)
      ? (row.close > row.ema9 ? "1" : "0")
      : "NA";

  row.close_gt_ema20 =
    Number.isFinite(row.close) && Number.isFinite(row.ema20)
      ? (row.close > row.ema20 ? "1" : "0")
      : "NA";

  row.atr_pct =
    Number.isFinite(row.atr) && Number.isFinite(row.close) && row.close !== 0
      ? row.atr / row.close
      : NaN;

  return row;
}

function pickBaseRow(arr) {
  const regular = arr.filter(
    r => r.time_minutes >= CONFIG.marketOpenMinutes && r.time_minutes <= CONFIG.cutoffMinutes
  );
  if (regular.length) return regular[0];

  const pre = arr.filter(
    r => r.time_minutes >= CONFIG.premarketStartMinutes && r.time_minutes < CONFIG.marketOpenMinutes
  );
  if (pre.length) return pre[pre.length - 1];

  return arr.length ? arr[0] : null;
}

function nextN(arr, idx, n) {
  return arr.slice(idx + 1, idx + 1 + n);
}

function computeBuySellSignals(regularRows, pmHigh, openPrice) {
  let buyOpportunities = 0;
  let sellFailures = 0;

  let runningHigh = -Infinity;
  let lastHigh = NaN;

  let lastBuySignalMinute = -Infinity;
  let lastSellSignalMinute = -Infinity;

  let belowVWAPStreak = 0;
  let lowerHighStreak = 0;

  for (let i = 0; i < regularRows.length; i++) {
    const row = regularRows[i];
    const prev = regularRows[i - 1];
    const fut = nextN(regularRows, i, 3);

    const futMaxHigh = maxFinite(fut.map(x => x.high));
    const futMinLow = minFinite(fut.map(x => x.low));

    const nearHod =
      Number.isFinite(row.distance_to_hod_pct) && row.distance_to_hod_pct <= 0.08;
    const nearPmHigh =
      Number.isFinite(row.distance_to_pm_high_pct) && row.distance_to_pm_high_pct <= 0.12;
    const aboveVWAP = row.close_gt_vwap === "1";
    const aboveEMA9 = row.close_gt_ema9 === "1";
    const inTrend = row.ema9_gt_ema20 === "1";

    const canCountBuy =
      row.time_minutes - lastBuySignalMinute >= CONFIG.buyCooldownMinutes;

    const canCountSell =
      row.time_minutes - lastSellSignalMinute >= CONFIG.sellCooldownMinutes;

    const controlledPullback =
      Number.isFinite(row.change_5m) &&
      row.change_5m >= -0.06 &&
      row.change_5m <= -0.01 &&
      (nearHod || nearPmHigh) &&
      (aboveVWAP || aboveEMA9);

    const recoveredAfterPullback =
      Number.isFinite(futMaxHigh) &&
      Number.isFinite(row.high) &&
      futMaxHigh >= row.high * 1.015;

    if (controlledPullback && recoveredAfterPullback && canCountBuy) {
      buyOpportunities++;
      lastBuySignalMinute = row.time_minutes;
    }

    const breaksRunningHigh =
      Number.isFinite(row.high) &&
      row.high > runningHigh &&
      row.time_minutes >= CONFIG.marketOpenMinutes + 1;

    const breakoutHeld =
      Number.isFinite(futMaxHigh) &&
      Number.isFinite(row.high) &&
      futMaxHigh >= row.high * 1.008 &&
      (!Number.isFinite(futMinLow) || futMinLow > row.close * 0.96);

    if (breaksRunningHigh && breakoutHeld && aboveVWAP && inTrend && canCountBuy) {
      buyOpportunities++;
      lastBuySignalMinute = row.time_minutes;
    }

    const prevBelowVWAP = prev && prev.close_gt_vwap === "0";
    const vwapReclaim =
      prevBelowVWAP &&
      row.close_gt_vwap === "1" &&
      Number.isFinite(futMaxHigh) &&
      futMaxHigh >= row.close * 1.012;

    if (vwapReclaim && canCountBuy) {
      buyOpportunities++;
      lastBuySignalMinute = row.time_minutes;
    }

    const openContinuation =
      Number.isFinite(openPrice) &&
      row.time_minutes <= CONFIG.marketOpenMinutes + 20 &&
      row.close >= openPrice &&
      aboveVWAP &&
      (inTrend || aboveEMA9) &&
      nearHod;

    if (openContinuation && Number.isFinite(futMaxHigh) && futMaxHigh >= row.close * 1.012 && canCountBuy) {
      buyOpportunities++;
      lastBuySignalMinute = row.time_minutes;
    }

    const failedBreakout =
      breaksRunningHigh &&
      Number.isFinite(futMinLow) &&
      Number.isFinite(row.close) &&
      futMinLow <= row.close * 0.95;

    if (failedBreakout && canCountSell) {
      sellFailures++;
      lastSellSignalMinute = row.time_minutes;
    }

    if (row.close_gt_vwap === "0") belowVWAPStreak++;
    else belowVWAPStreak = 0;

    if (belowVWAPStreak >= 3 && canCountSell) {
      sellFailures++;
      lastSellSignalMinute = row.time_minutes;
      belowVWAPStreak = 0;
    }

    if (Number.isFinite(lastHigh) && Number.isFinite(row.high) && row.high < lastHigh) {
      lowerHighStreak++;
    } else {
      lowerHighStreak = 0;
    }

    if (
      lowerHighStreak >= 3 &&
      Number.isFinite(pmHigh) &&
      row.close < pmHigh * 0.96 &&
      canCountSell
    ) {
      sellFailures++;
      lastSellSignalMinute = row.time_minutes;
      lowerHighStreak = 0;
    }

    const heavyRedBreak =
      Number.isFinite(row.open) &&
      Number.isFinite(row.close) &&
      row.close < row.open * 0.96 &&
      row.close_gt_vwap === "0" &&
      (nearHod || nearPmHigh);

    if (heavyRedBreak && canCountSell) {
      sellFailures++;
      lastSellSignalMinute = row.time_minutes;
    }

    if (Number.isFinite(row.high)) {
      if (row.high > runningHigh) runningHigh = row.high;
      lastHigh = row.high;
    }
  }

  return { buyOpportunities, sellFailures };
}

function computeMomentumDayQuality(rows) {
  const sorted = [...rows].sort((a, b) => a.time_minutes - b.time_minutes);

  const dayRows = sorted.filter(
    r => r.time_minutes >= CONFIG.premarketStartMinutes && r.time_minutes <= CONFIG.cutoffMinutes
  );
  if (!dayRows.length) return null;

  const preRows = dayRows.filter(r => r.time_minutes < CONFIG.marketOpenMinutes);
  const regularRows = dayRows.filter(
    r => r.time_minutes >= CONFIG.marketOpenMinutes && r.time_minutes <= CONFIG.cutoffMinutes
  );

  const baseRow = pickBaseRow(dayRows);
  if (!baseRow) return null;

  const openRow = regularRows[0] || null;
  const rowAt12 = regularRows.length ? regularRows[regularRows.length - 1] : (dayRows[dayRows.length - 1] || null);

  const dayHighToNoon = maxFinite(dayRows.map(r => r.high));
  const pmHigh = maxFinite(preRows.map(r => r.high));
  const pmLow = minFinite(preRows.map(r => r.low));
  const pmOpen = preRows.length ? preRows[0].open : NaN;
  const pmClose = preRows.length ? preRows[preRows.length - 1].close : NaN;

  const postOpenHigh = maxFinite(regularRows.map(r => r.high));
  const postOpenLow = minFinite(regularRows.map(r => r.low));

  const openPrice = Number.isFinite(openRow?.open) ? openRow.open : NaN;
  const close12 = Number.isFinite(rowAt12?.close) ? rowAt12.close : NaN;
  const vwap12 = Number.isFinite(rowAt12?.vwap) ? rowAt12.vwap : NaN;

  const highAfter10 = maxFinite(
    regularRows.filter(r => r.time_minutes >= 10 * 60).map(r => r.high)
  );

  const madeNewHighAfterOpen =
    Number.isFinite(postOpenHigh) && Number.isFinite(pmHigh)
      ? (postOpenHigh > pmHigh ? 1 : 0)
      : (Number.isFinite(postOpenHigh) ? 1 : 0);

  const madeNewHighAfter10 =
    Number.isFinite(highAfter10) && Number.isFinite(pmHigh)
      ? (highAfter10 > pmHigh ? 1 : 0)
      : (Number.isFinite(highAfter10) ? 1 : 0);

  const minutesAboveVWAPRatio = safeDiv(
    regularRows.filter(r => r.close_gt_vwap === "1").length,
    regularRows.length
  );

  const minutesAboveEMA9Ratio = safeDiv(
    regularRows.filter(r => r.close_gt_ema9 === "1").length,
    regularRows.length
  );

  const greenBarRatio = safeDiv(
    regularRows.filter(r => Number.isFinite(r.close) && Number.isFinite(r.open) && r.close > r.open).length,
    regularRows.length
  );

  const redBarRatio = safeDiv(
    regularRows.filter(r => Number.isFinite(r.close) && Number.isFinite(r.open) && r.close < r.open).length,
    regularRows.length
  );

  const maxDrawdownFromPostOpenHod =
    Number.isFinite(postOpenHigh) && Number.isFinite(postOpenLow) && postOpenHigh > 0
      ? (postOpenHigh - postOpenLow) / postOpenHigh
      : NaN;

  const close12FromOpenPct =
    Number.isFinite(close12) && Number.isFinite(openPrice) && openPrice !== 0
      ? (close12 - openPrice) / openPrice
      : NaN;

  const close12FromPmHighPct =
    Number.isFinite(close12) && Number.isFinite(pmHigh) && pmHigh !== 0
      ? (close12 - pmHigh) / pmHigh
      : NaN;

  const noonDistanceToHodPct =
    Number.isFinite(dayHighToNoon) && Number.isFinite(close12) && close12 !== 0
      ? (dayHighToNoon - close12) / close12
      : NaN;

  const pmRangePct =
    Number.isFinite(pmHigh) && Number.isFinite(pmLow) && pmLow > 0
      ? (pmHigh - pmLow) / pmLow
      : NaN;

  const pmCloseVsHighPct =
    Number.isFinite(pmClose) && Number.isFinite(pmHigh) && pmHigh !== 0
      ? (pmClose - pmHigh) / pmHigh
      : NaN;

  const pmCloseVsOpenPct =
    Number.isFinite(pmClose) && Number.isFinite(pmOpen) && pmOpen !== 0
      ? (pmClose - pmOpen) / pmOpen
      : NaN;

  const pmHodEqualsDayHod =
    Number.isFinite(pmHigh) && Number.isFinite(dayHighToNoon)
      ? (Math.abs(pmHigh - dayHighToNoon) < 1e-10 ? 1 : 0)
      : 0;

  const buySell = computeBuySellSignals(regularRows, pmHigh, openPrice);

  let momentumQualityScore = 0;
  momentumQualityScore += buySell.buyOpportunities * 2.0;
  momentumQualityScore -= buySell.sellFailures * 1.5;
  momentumQualityScore += madeNewHighAfterOpen ? 1.0 : 0;
  momentumQualityScore += madeNewHighAfter10 ? 0.75 : 0;
  momentumQualityScore += Number.isFinite(minutesAboveVWAPRatio) ? minutesAboveVWAPRatio * 2.0 : 0;
  momentumQualityScore += Number.isFinite(minutesAboveEMA9Ratio) ? minutesAboveEMA9Ratio * 1.0 : 0;
  momentumQualityScore += Number.isFinite(greenBarRatio) ? greenBarRatio * 0.75 : 0;
  momentumQualityScore -= Number.isFinite(redBarRatio) ? redBarRatio * 0.75 : 0;
  momentumQualityScore += Number.isFinite(close12FromOpenPct) ? Math.max(0, close12FromOpenPct) * 8 : 0;
  momentumQualityScore -= Number.isFinite(maxDrawdownFromPostOpenHod) ? maxDrawdownFromPostOpenHod * 5 : 0;
  momentumQualityScore -= pmHodEqualsDayHod ? 0.75 : 0;

  // Features válidas al base row
  const openToBasePct =
    Number.isFinite(baseRow.close) && Number.isFinite(openPrice) && openPrice !== 0
      ? (baseRow.close - openPrice) / openPrice
      : NaN;

  const pmToOpenGapPct =
    Number.isFinite(openPrice) && Number.isFinite(pmClose) && pmClose !== 0
      ? (openPrice - pmClose) / pmClose
      : NaN;

  const pmToBaseRetPct =
    Number.isFinite(baseRow.close) && Number.isFinite(pmClose) && pmClose !== 0
      ? (baseRow.close - pmClose) / pmClose
      : NaN;

  const baseRangePct =
    Number.isFinite(baseRow.high) && Number.isFinite(baseRow.low) && baseRow.low > 0
      ? (baseRow.high - baseRow.low) / baseRow.low
      : NaN;

  const volumeVsPremarketVolume =
    Number.isFinite(baseRow.volume) && Number.isFinite(baseRow.premarket_volume) && baseRow.premarket_volume > 0
      ? baseRow.volume / baseRow.premarket_volume
      : NaN;

  return {
    symbol: baseRow.symbol,
    date: baseRow.date,

    // snapshot de entrada
    ...baseRow,

    // features válidas al base row
    pm_range_pct: pmRangePct,
    pm_close_vs_high_pct: pmCloseVsHighPct,
    pm_close_vs_open_pct: pmCloseVsOpenPct,
    pm_to_open_gap_pct: pmToOpenGapPct,
    pm_to_base_ret_pct: pmToBaseRetPct,
    open_to_base_pct: openToBasePct,
    base_range_pct: baseRangePct,
    volume_vs_premarket_volume: volumeVsPremarketVolume,
    base_in_open_window:
      baseRow.time_minutes >= CONFIG.marketOpenMinutes &&
      baseRow.time_minutes <= CONFIG.marketOpenMinutes + 20
        ? "1"
        : "0",

    // métricas futuras SOLO para label/evaluación
    buy_opportunities: buySell.buyOpportunities,
    sell_failures: buySell.sellFailures,
    minutes_above_vwap_ratio: minutesAboveVWAPRatio,
    minutes_above_ema9_ratio: minutesAboveEMA9Ratio,
    green_bar_ratio: greenBarRatio,
    red_bar_ratio: redBarRatio,
    made_new_high_after_open: String(madeNewHighAfterOpen),
    made_new_high_after_10: String(madeNewHighAfter10),
    max_drawdown_from_post_open_hod: maxDrawdownFromPostOpenHod,
    close12_from_open_pct: close12FromOpenPct,
    close12_from_pm_high_pct: close12FromPmHighPct,
    close12_gt_open:
      Number.isFinite(close12) && Number.isFinite(openPrice) ? String(close12 > openPrice ? 1 : 0) : "NA",
    close12_gt_vwap:
      Number.isFinite(close12) && Number.isFinite(vwap12) ? String(close12 > vwap12 ? 1 : 0) : "NA",
    noon_distance_to_hod_pct: noonDistanceToHodPct,
    pm_hod_equals_day_hod: String(pmHodEqualsDayHod),
    momentum_quality_score: momentumQualityScore,

    is_true_momentum_stock: 0,
    is_elite_momentum_stock: 0,
    is_negative_momentum_stock: 1,
  };
}

async function partitionCsvIntoBuckets(filePath) {
  log(`Particionando CSV en ${CONFIG.bucketCount} buckets...`);
  fs.rmSync(CONFIG.tmpRootDir, { recursive: true, force: true });
  ensureDir(CONFIG.tmpRootDir);

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let delimiter = ",";
  let firstNonEmptySeen = false;
  let hasHeader = false;
  let lineNumber = 0;
  let validRows = 0;
  let skippedRows = 0;

  const writers = new Array(CONFIG.bucketCount).fill(null).map((_, i) => {
    const bucketPath = path.join(CONFIG.tmpRootDir, `bucket_${String(i).padStart(3, "0")}.csv`);
    return {
      path: bucketPath,
      stream: fs.createWriteStream(bucketPath, { encoding: "utf8" }),
    };
  });

  for await (const rawLine of rl) {
    lineNumber++;
    const line = String(rawLine).trimEnd();
    if (!line) continue;

    if (!firstNonEmptySeen) {
      firstNonEmptySeen = true;
      delimiter = detectDelimiter(line);

      const firstParts = line.split(delimiter).map(x => x.trim());
      hasHeader =
        firstParts[0]?.toLowerCase() === "symbol" ||
        firstParts.includes("close");

      log(`Delimitador detectado: ${delimiter === "\t" ? "TAB" : "COMMA"}`);
      log(`Header detectado: ${hasHeader ? "sí" : "no"}`);

      if (hasHeader) continue;
    }

    const parts = line.split(delimiter);
    const row = parseRowFromParts(parts);
    if (!row) {
      skippedRows++;
      continue;
    }

    const key = `${row.symbol}__${row.date}`;
    const bucketIdx = hashString(key) % CONFIG.bucketCount;
    writers[bucketIdx].stream.write(line + "\n");
    validRows++;

    if (lineNumber % 500000 === 0) {
      log(`Particionadas ${lineNumber} líneas... válidas=${validRows}, descartadas=${skippedRows}`);
    }
  }

  for (const w of writers) {
    await new Promise(resolve => w.stream.end(resolve));
  }

  log(`Particionado completado. válidas=${validRows}, descartadas=${skippedRows}`);
  return writers.map(x => x.path).filter(p => fs.existsSync(p) && fs.statSync(p).size > 0);
}

async function parseBucketFile(bucketPath) {
  const grouped = new Map();

  const stream = fs.createReadStream(bucketPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let delimiter = ",";
  let firstNonEmptySeen = false;

  for await (const rawLine of rl) {
    const line = String(rawLine).trimEnd();
    if (!line) continue;

    if (!firstNonEmptySeen) {
      firstNonEmptySeen = true;
      delimiter = detectDelimiter(line);
    }

    const parts = line.split(delimiter);
    const row = parseRowFromParts(parts);
    if (!row) continue;

    const key = `${row.symbol}__${row.date}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  return grouped;
}

async function buildStockDayDatasetFromBuckets(bucketPaths) {
  log("Procesando buckets y construyendo dataset de momentum stock-days...");
  const out = [];

  for (let i = 0; i < bucketPaths.length; i++) {
    const bucketPath = bucketPaths[i];
    log(`Procesando bucket ${i + 1}/${bucketPaths.length}: ${path.basename(bucketPath)}`);

    const grouped = await parseBucketFile(bucketPath);
    for (const [, rows] of grouped.entries()) {
      const summary = computeMomentumDayQuality(rows);
      if (summary) out.push(summary);
    }
  }

  log(`Stock-days válidos: ${out.length}`);
  return out;
}

function assignLabelsByScore(rows) {
  const scores = rows
    .map(r => r.momentum_quality_score)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const trueCut = percentile(scores, CONFIG.trueMomentumScoreQuantile);
  const eliteCut = percentile(scores, CONFIG.eliteMomentumScoreQuantile);

  for (const row of rows) {
    row.is_true_momentum_stock =
      Number.isFinite(row.momentum_quality_score) && row.momentum_quality_score >= trueCut ? 1 : 0;

    row.is_elite_momentum_stock =
      Number.isFinite(row.momentum_quality_score) && row.momentum_quality_score >= eliteCut ? 1 : 0;

    row.is_negative_momentum_stock = row.is_true_momentum_stock ? 0 : 1;
  }

  return { trueCut, eliteCut };
}

function computeBaseline(rows) {
  const count = rows.length;
  const positive = rows.reduce((a, r) => a + (r.is_true_momentum_stock || 0), 0);
  const elite = rows.reduce((a, r) => a + (r.is_elite_momentum_stock || 0), 0);
  const negative = count - positive;

  return {
    count,
    positive,
    elite,
    negative,
    positiveRate: safeDiv(positive, count),
    eliteRate: safeDiv(elite, count),
    negativeRate: safeDiv(negative, count),
    avgBuyOpportunities: mean(rows.map(r => r.buy_opportunities)),
    avgSellFailures: mean(rows.map(r => r.sell_failures)),
    avgMomentumQualityScore: mean(rows.map(r => r.momentum_quality_score)),
  };
}

function generateThresholds(rows, feature) {
  const vals = rows
    .map(r => r[feature])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (vals.length < 50) return [];
  return uniqueSorted(CONFIG.quantiles.map(q => percentile(vals, q)));
}

function buildCandidateConditions(rows) {
  log("Generando condiciones candidatas...");
  const out = [];

  for (const feature of RULE_FEATURES_NUMERIC) {
    const thresholds = generateThresholds(rows, feature);
    for (const t of thresholds) {
      out.push({ feature, type: "gte", value: t });
      out.push({ feature, type: "lte", value: t });
    }
    for (let i = 0; i < thresholds.length - 1; i++) {
      const min = thresholds[i];
      const max = thresholds[i + 1];
      if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
        out.push({ feature, type: "between", min, max });
      }
    }
  }

  for (const feature of RULE_FEATURES_CATEGORICAL) {
    const values = [...new Set(rows.map(r => r[feature]).filter(v => v !== undefined && v !== null && v !== ""))];
    for (const value of values) out.push({ feature, type: "eq", value });
  }

  const dedup = new Map();
  for (const c of out) dedup.set(describeCondition(c), c);
  return [...dedup.values()];
}

function applyCondition(row, cond) {
  const v = row[cond.feature];

  if (cond.type === "gte") return Number.isFinite(v) && v >= cond.value;
  if (cond.type === "lte") return Number.isFinite(v) && v <= cond.value;
  if (cond.type === "eq") return String(v) === String(cond.value);
  if (cond.type === "between") return Number.isFinite(v) && v >= cond.min && v <= cond.max;
  return false;
}

function describeCondition(cond) {
  if (cond.type === "gte") return `${cond.feature} >= ${round(cond.value, 6)}`;
  if (cond.type === "lte") return `${cond.feature} <= ${round(cond.value, 6)}`;
  if (cond.type === "eq") return `${cond.feature} == ${cond.value}`;
  if (cond.type === "between") return `${cond.feature} in [${round(cond.min, 6)}, ${round(cond.max, 6)}]`;
  return JSON.stringify(cond);
}

function isBadRule(conds) {
  const features = conds.map(c => c.feature);
  if (new Set(features).size !== features.length) return true;

  if (CONFIG.rejectNARules) {
    for (const c of conds) {
      if (c.type === "eq" && String(c.value) === "NA") return true;
    }
  }
  return false;
}

function computeRuleStats(subset, baseline) {
  const count = subset.length;
  const positive = subset.reduce((a, r) => a + (r.is_true_momentum_stock || 0), 0);
  const elite = subset.reduce((a, r) => a + (r.is_elite_momentum_stock || 0), 0);
  const negative = count - positive;

  const positiveRate = safeDiv(positive, count);
  const eliteRate = safeDiv(elite, count);
  const negativeRate = safeDiv(negative, count);
  const lift = positiveRate - baseline.positiveRate;

  return {
    count,
    positive,
    elite,
    negative,
    positiveRate,
    eliteRate,
    negativeRate,
    lift,
    avgBuyOpportunities: mean(subset.map(r => r.buy_opportunities)),
    avgSellFailures: mean(subset.map(r => r.sell_failures)),
    avgMomentumQualityScore: mean(subset.map(r => r.momentum_quality_score)),
  };
}

function scoreRule(stats) {
  if (!stats.count) return -Infinity;
  return (
    (stats.positiveRate - stats.negativeRate * 0.35 + stats.eliteRate * 0.45) *
    Math.sqrt(stats.count)
  );
}

function evaluateRule(rows, conds, baseline, ruleName = null) {
  if (isBadRule(conds)) return null;

  const subset = rows.filter(r => conds.every(c => applyCondition(r, c)));
  const stats = computeRuleStats(subset, baseline);
  const score = scoreRule(stats);

  const ok =
    stats.count > 0 &&
    stats.positiveRate >= CONFIG.minPositiveRate &&
    stats.negativeRate <= CONFIG.maxNegativeRate &&
    stats.lift >= CONFIG.minLift;

  return {
    name: ruleName,
    rule: conds.map(describeCondition).join(" AND "),
    conditions: conds,
    stats,
    score,
    lift: stats.lift,
    ok,
  };
}

function searchSingleRules(rows, baseline, candidates) {
  const results = [];
  for (let i = 0; i < candidates.length; i++) {
    const evaluated = evaluateRule(rows, [candidates[i]], baseline);
    if (!evaluated) continue;
    if (evaluated.ok && evaluated.stats.count >= CONFIG.minSamplesSingle) results.push(evaluated);
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, CONFIG.topSingle);
}

function combinations(arr, k, start = 0, prefix = [], out = []) {
  if (prefix.length === k) {
    out.push([...prefix]);
    return out;
  }
  for (let i = start; i < arr.length; i++) {
    prefix.push(arr[i]);
    combinations(arr, k, i + 1, prefix, out);
    prefix.pop();
  }
  return out;
}

function searchKRules(rows, baseline, seedConditions, k, minSamples, topN) {
  const combos = combinations(seedConditions, k);
  const results = [];

  for (let i = 0; i < combos.length; i++) {
    const evaluated = evaluateRule(rows, combos[i], baseline);
    if (!evaluated) continue;
    if (evaluated.ok && evaluated.stats.count >= minSamples) results.push(evaluated);
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}

function evaluateManualRules(rows, baseline) {
  const results = [];
  for (const ruleDef of MANUAL_RULES) {
    const evaluated = evaluateRule(rows, ruleDef.conditions, baseline, ruleDef.name);
    if (!evaluated) continue;
    if (evaluated.stats.count > 0) results.push(evaluated);
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

function generatePrefilterFile(bestRule) {
  const body = [];
  body.push("function passesGeneratedMomentumPreFilter(row) {");
  body.push("  return (");

  bestRule.conditions.forEach((c, idx) => {
    let expr = "";
    if (c.type === "gte") expr = `Number.isFinite(row.${c.feature}) && row.${c.feature} >= ${c.value}`;
    else if (c.type === "lte") expr = `Number.isFinite(row.${c.feature}) && row.${c.feature} <= ${c.value}`;
    else if (c.type === "eq") expr = `String(row.${c.feature}) === ${JSON.stringify(c.value)}`;
    else if (c.type === "between") expr = `Number.isFinite(row.${c.feature}) && row.${c.feature} >= ${c.min} && row.${c.feature} <= ${c.max}`;

    body.push(`    (${expr})${idx === bestRule.conditions.length - 1 ? "" : " &&"}`);
  });

  body.push("  );");
  body.push("}");
  body.push("");
  body.push("module.exports = { passesGeneratedMomentumPreFilter };");
  return body.join("\n");
}

function printRules(title, rules, n = 10) {
  console.log(`\n===== ${title} =====\n`);
  for (const r of rules.slice(0, n)) {
    console.log(
      [
        r.name ? `name=${r.name}` : null,
        r.rule,
        `count=${r.stats.count}`,
        `positive=${formatPct(r.stats.positiveRate)}`,
        `elite=${formatPct(r.stats.eliteRate)}`,
        `negative=${formatPct(r.stats.negativeRate)}`,
        `lift=${formatPct(r.lift)}`,
        `avgBuy=${round(r.stats.avgBuyOpportunities, 4)}`,
        `avgSell=${round(r.stats.avgSellFailures, 4)}`,
        `avgScore=${round(r.stats.avgMomentumQualityScore, 4)}`,
        `score=${round(r.score, 6)}`,
      ].filter(Boolean).join(" | ")
    );
  }
}

async function main() {
  const inputPath = path.resolve(CONFIG.inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`No existe archivo: ${inputPath}`);
    process.exit(1);
  }

  const bucketPaths = await partitionCsvIntoBuckets(inputPath);
  const rows = await buildStockDayDatasetFromBuckets(bucketPaths);

  const cuts = assignLabelsByScore(rows);
  writeJson("momentum_score_cuts.json", cuts);
  writeJson("momentum_stockdays.json", rows);

  const baseline = computeBaseline(rows);
  writeJson("momentum_baseline.json", baseline);

  log(
    `Baseline momentum: count=${baseline.count}, positive=${formatPct(
      baseline.positiveRate
    )}, elite=${formatPct(baseline.eliteRate)}, negative=${formatPct(baseline.negativeRate)}`
  );

  log(`Score cut true=${round(cuts.trueCut, 6)}, elite=${round(cuts.eliteCut, 6)}`);

  const manualRules = evaluateManualRules(rows, baseline);
  writeJson("momentum_manual_rules.json", manualRules);

  const candidates = buildCandidateConditions(rows);
  const singleRules = searchSingleRules(rows, baseline, candidates);
  writeJson("momentum_single_rules.json", singleRules);

  const seedConditions = [
    ...new Map(
      singleRules
        .slice(0, CONFIG.topSeedSingles)
        .flatMap(r => r.conditions)
        .map(c => [describeCondition(c), c])
    ).values(),
  ];

  const pairRules = searchKRules(rows, baseline, seedConditions, 2, CONFIG.minSamplesPair, CONFIG.topPair);
  const tripleRules = searchKRules(rows, baseline, seedConditions, 3, CONFIG.minSamplesTriple, CONFIG.topTriple);
  const quadRules = searchKRules(rows, baseline, seedConditions, 4, CONFIG.minSamplesQuad, CONFIG.topQuad);

  writeJson("momentum_pair_rules.json", pairRules);
  writeJson("momentum_triple_rules.json", tripleRules);
  writeJson("momentum_quad_rules.json", quadRules);

  const bestOverall = [
    ...manualRules,
    ...quadRules,
    ...tripleRules,
    ...pairRules,
    ...singleRules,
  ].sort((a, b) => b.score - a.score)[0];

  if (bestOverall) {
    fs.writeFileSync(
      path.join(CONFIG.outputDir, "generated-prefilter-momentum.js"),
      generatePrefilterFile(bestOverall)
    );
  }

  printRules("TOP MANUAL RULES MOMENTUM", manualRules, 12);
  printRules("TOP SINGLE RULES MOMENTUM", singleRules, 12);
  printRules("TOP PAIR RULES MOMENTUM", pairRules, 12);
  printRules("TOP TRIPLE RULES MOMENTUM", tripleRules, 12);
  printRules("TOP QUAD RULES MOMENTUM", quadRules, 12);

  log("Archivos generados:");
  log("- momentum_score_cuts.json");
  log("- momentum_stockdays.json");
  log("- momentum_baseline.json");
  log("- momentum_manual_rules.json");
  log("- momentum_single_rules.json");
  log("- momentum_pair_rules.json");
  log("- momentum_triple_rules.json");
  log("- momentum_quad_rules.json");
  log("- generated-prefilter-momentum.js");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});