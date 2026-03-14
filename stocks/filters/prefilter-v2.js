#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const CONFIG = {
  inputFile: process.argv[2] || "../stock-training/data/backups/training.csv",
  outputDir: ".",

  // TARGET intradía calculado por el script
  tpPct: 0.04,       // +4%
  slPct: 0.02,       // -2%
  lookaheadBars: 10, // próximas 10 velas

  quantiles: [0.25, 0.5, 0.75],

  minSamplesSingle: 30,
  minSamplesPair: 20,

  topSingle: 25,
  topPair: 25,

  thresholdFeatures: [
    "change_pct_at_candle",
    "change_1m",
    "change_5m",
    "change_10m",
    "minutes_since_hod",
    "distance_to_hod_pct",
    "distance_to_vwap_pct",
    "distance_to_pm_high_pct",
    "ema_spread_pct",
    "extension_vs_atr",
    "dollar_volume",
  ],

  categoricalFeatures: [
    "session",
    "close_gt_vwap",
    "ema9_gt_ema20",
    "close_gt_ema9",
    "close_gt_ema20",
  ],

  minTimeMinutes: 570, // 9:30
  maxTimeMinutes: 630, // 10:30

  oneRowPerSymbolDayInWindow: false,
  dropBadRows: true,
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

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
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

function parseCsv(filePath) {
  log(`Leyendo CSV: ${filePath}`);
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map(x => x.trimEnd())
    .filter(x => x.length > 0);

  if (!lines.length) throw new Error("CSV vacío");

  const delimiter = detectDelimiter(lines[0]);
  log(`Delimitador detectado: ${delimiter === "\t" ? "TAB" : "COMMA"}`);

  const firstParts = lines[0].split(delimiter).map(x => x.trim());
  const hasHeader =
    firstParts[0]?.toLowerCase() === "symbol" ||
    firstParts.includes("close");

  log(`Header detectado: ${hasHeader ? "sí" : "no"}`);

  const startIndex = hasHeader ? 1 : 0;
  const rows = [];

  for (let i = startIndex; i < lines.length; i++) {
    if (i % 50000 === 0 && i > startIndex) log(`Parseando fila ${i}...`);

    const parts = lines[i].split(delimiter);
    if (parts.length < 15) continue;

    const row = {};
    for (let c = 0; c < LEADING_COLUMNS.length; c++) row[LEADING_COLUMNS[c]] = parts[c] ?? "";

    const numericFields = [
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

    for (const f of numericFields) row[f] = toNum(row[f]);

    row.symbol = String(row.symbol || "").trim();
    row.date = String(row.date || "").trim();
    row.candle_time_et = String(row.candle_time_et || "").trim();
    row.session = String(row.session || "").trim();
    row.time_minutes = parseTimeToMinutes(row.candle_time_et);

    if (CONFIG.dropBadRows) {
      if (!Number.isFinite(row.close) || row.close <= 0) continue;
      if (!Number.isFinite(row.high) || !Number.isFinite(row.low)) continue;
    }

    row.dollar_volume = Number.isFinite(row.close) && Number.isFinite(row.volume)
      ? row.close * row.volume
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
      Number.isFinite(row.close) && Number.isFinite(row.ema9) && Number.isFinite(row.atr) && row.atr !== 0
        ? (row.close - row.ema9) / row.atr
        : NaN;

    row.close_gt_vwap =
      Number.isFinite(row.close) && Number.isFinite(row.vwap) ? (row.close > row.vwap ? "1" : "0") : "NA";

    row.ema9_gt_ema20 =
      Number.isFinite(row.ema9) && Number.isFinite(row.ema20) ? (row.ema9 > row.ema20 ? "1" : "0") : "NA";

    row.close_gt_ema9 =
      Number.isFinite(row.close) && Number.isFinite(row.ema9) ? (row.close > row.ema9 ? "1" : "0") : "NA";

    row.close_gt_ema20 =
      Number.isFinite(row.close) && Number.isFinite(row.ema20) ? (row.close > row.ema20 ? "1" : "0") : "NA";

    rows.push(row);
  }

  log(`Filas parseadas válidas: ${rows.length}`);
  return rows;
}

function groupByStockDay(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.symbol}__${row.date}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  for (const [, arr] of grouped.entries()) {
    arr.sort((a, b) => {
      const ta = Number.isFinite(a.time_minutes) ? a.time_minutes : Infinity;
      const tb = Number.isFinite(b.time_minutes) ? b.time_minutes : Infinity;
      return ta - tb;
    });
  }

  return grouped;
}

function computeIntradayTarget(baseRow, futureRows) {
  const entry = baseRow.close;
  if (!Number.isFinite(entry) || entry <= 0) {
    return {
      is_good: 0,
      is_bad: 0,
      is_neutral: 1,
      hit_tp_first: false,
      hit_sl_first: false,
      future_max_return: NaN,
      future_min_return: NaN,
    };
  }

  const lookahead = futureRows.slice(0, CONFIG.lookaheadBars);

  let hitTpFirst = false;
  let hitSlFirst = false;
  let futureMax = -Infinity;
  let futureMin = Infinity;

  for (const row of lookahead) {
    const highRet = Number.isFinite(row.high) ? (row.high - entry) / entry : NaN;
    const lowRet = Number.isFinite(row.low) ? (row.low - entry) / entry : NaN;

    if (Number.isFinite(highRet) && highRet > futureMax) futureMax = highRet;
    if (Number.isFinite(lowRet) && lowRet < futureMin) futureMin = lowRet;

    const tpHit = Number.isFinite(highRet) && highRet >= CONFIG.tpPct;
    const slHit = Number.isFinite(lowRet) && lowRet <= -CONFIG.slPct;

    if (tpHit && slHit) {
      break;
    }
    if (tpHit) {
      hitTpFirst = true;
      break;
    }
    if (slHit) {
      hitSlFirst = true;
      break;
    }
  }

  return {
    is_good: hitTpFirst ? 1 : 0,
    is_bad: hitSlFirst ? 1 : 0,
    is_neutral: !hitTpFirst && !hitSlFirst ? 1 : 0,
    hit_tp_first: hitTpFirst,
    hit_sl_first: hitSlFirst,
    future_max_return: Number.isFinite(futureMax) ? futureMax : NaN,
    future_min_return: Number.isFinite(futureMin) ? futureMin : NaN,
  };
}

function buildIntradayDataset(rows) {
  log("Construyendo dataset intradía con target calculado...");
  const grouped = groupByStockDay(rows);
  const out = [];

  for (const [, arr] of grouped.entries()) {
    const candidates = arr.filter(r =>
      Number.isFinite(r.time_minutes) &&
      r.time_minutes >= CONFIG.minTimeMinutes &&
      r.time_minutes <= CONFIG.maxTimeMinutes
    );

    if (!candidates.length) continue;

    if (CONFIG.oneRowPerSymbolDayInWindow) {
      const baseRow = candidates[0];
      const baseIdx = arr.indexOf(baseRow);
      const futureRows = arr.slice(baseIdx + 1);
      out.push({
        ...baseRow,
        ...computeIntradayTarget(baseRow, futureRows),
      });
    } else {
      for (const baseRow of candidates) {
        const baseIdx = arr.indexOf(baseRow);
        const futureRows = arr.slice(baseIdx + 1);
        out.push({
          ...baseRow,
          ...computeIntradayTarget(baseRow, futureRows),
        });
      }
    }
  }

  log(`Filas intradía finales con target: ${out.length}`);
  return out;
}

function computeStats(rows) {
  const count = rows.length;
  const goods = rows.reduce((a, r) => a + (r.is_good || 0), 0);
  const bads = rows.reduce((a, r) => a + (r.is_bad || 0), 0);
  const neutrals = rows.reduce((a, r) => a + (r.is_neutral || 0), 0);

  return {
    count,
    goods,
    bads,
    neutrals,
    goodRate: safeDiv(goods, count),
    badRate: safeDiv(bads, count),
    neutralRate: safeDiv(neutrals, count),
    avgFutureMaxReturn: mean(rows.map(r => r.future_max_return)),
    avgFutureMinReturn: mean(rows.map(r => r.future_min_return)),
  };
}

function scoreRule(stats, baseline) {
  if (!stats.count) return -Infinity;
  const lift = stats.goodRate - baseline.goodRate;
  return (lift - (stats.badRate || 0) * 0.5) * Math.sqrt(stats.count);
}

function generateThresholds(rows, feature) {
  const vals = rows.map(r => r[feature]).filter(Number.isFinite).sort((a, b) => a - b);
  if (vals.length < 25) return [];
  return uniqueSorted(CONFIG.quantiles.map(q => percentile(vals, q)));
}

function applyCondition(row, cond) {
  const v = row[cond.feature];
  if (cond.type === "gte") return Number.isFinite(v) && v >= cond.value;
  if (cond.type === "lte") return Number.isFinite(v) && v <= cond.value;
  if (cond.type === "eq") return String(v) === String(cond.value);
  return false;
}

function describeCondition(cond) {
  if (cond.type === "gte") return `${cond.feature} >= ${round(cond.value, 6)}`;
  if (cond.type === "lte") return `${cond.feature} <= ${round(cond.value, 6)}`;
  if (cond.type === "eq") return `${cond.feature} == ${cond.value}`;
  return JSON.stringify(cond);
}

function evaluateRule(rows, conds, baseline) {
  const subset = rows.filter(r => conds.every(c => applyCondition(r, c)));
  const stats = computeStats(subset);
  const score = scoreRule(stats, baseline);
  return {
    rule: conds.map(describeCondition).join(" AND "),
    conditions: conds,
    stats,
    score,
    lift: stats.goodRate - baseline.goodRate,
  };
}

function buildCandidateConditions(rows) {
  log("Generando condiciones candidatas intradía...");
  const out = [];

  for (const feature of CONFIG.thresholdFeatures) {
    const thresholds = generateThresholds(rows, feature);
    log(`Feature ${feature}: ${thresholds.length} thresholds`);
    for (const t of thresholds) {
      out.push({ feature, type: "gte", value: t });
      out.push({ feature, type: "lte", value: t });
    }
  }

  for (const feature of CONFIG.categoricalFeatures) {
    const values = [...new Set(rows.map(r => r[feature]).filter(v => v !== undefined && v !== null && v !== ""))];
    log(`Feature categórica ${feature}: ${values.length} values`);
    for (const value of values) out.push({ feature, type: "eq", value });
  }

  const dedup = new Map();
  for (const c of out) dedup.set(describeCondition(c), c);

  const finalConds = [...dedup.values()];
  log(`Condiciones candidatas intradía finales: ${finalConds.length}`);
  return finalConds;
}

function searchSingleRules(rows, baseline, candidates) {
  log("Buscando reglas simples intradía...");
  const results = [];
  for (let i = 0; i < candidates.length; i++) {
    if (i % 20 === 0) log(`Reglas simples intradía: ${i}/${candidates.length}`);
    const rule = evaluateRule(rows, [candidates[i]], baseline);
    if (rule.stats.count >= CONFIG.minSamplesSingle) results.push(rule);
  }
  results.sort((a, b) => b.score - a.score);
  log(`Reglas simples intradía válidas: ${results.length}`);
  return results.slice(0, CONFIG.topSingle);
}

function searchPairRules(rows, baseline, seedConditions) {
  log("Buscando reglas dobles intradía...");
  const results = [];
  let tested = 0;

  for (let i = 0; i < seedConditions.length; i++) {
    for (let j = i + 1; j < seedConditions.length; j++) {
      const a = seedConditions[i];
      const b = seedConditions[j];
      if (a.feature === b.feature) continue;

      tested++;
      if (tested % 100 === 0) log(`Reglas dobles intradía probadas: ${tested}`);

      const rule = evaluateRule(rows, [a, b], baseline);
      if (rule.stats.count >= CONFIG.minSamplesPair) results.push(rule);
    }
  }

  results.sort((a, b) => b.score - a.score);
  log(`Reglas dobles intradía válidas: ${results.length}`);
  return results.slice(0, CONFIG.topPair);
}

function writeJson(name, data) {
  fs.writeFileSync(path.join(CONFIG.outputDir, name), JSON.stringify(data, null, 2));
}

function printRules(title, rules, n = 10) {
  console.log(`\n===== ${title} =====\n`);
  for (const r of rules.slice(0, n)) {
    console.log(
      [
        r.rule,
        `count=${r.stats.count}`,
        `good=${formatPct(r.stats.goodRate)}`,
        `bad=${formatPct(r.stats.badRate)}`,
        `lift=${formatPct(r.lift)}`,
        `avgMax=${round(r.stats.avgFutureMaxReturn, 6)}`,
        `avgMin=${round(r.stats.avgFutureMinReturn, 6)}`,
        `score=${round(r.score, 6)}`,
      ].join(" | ")
    );
  }
}

function main() {
  const inputPath = path.resolve(CONFIG.inputFile);
  if (!fs.existsSync(inputPath)) {
    console.error(`No existe archivo: ${inputPath}`);
    process.exit(1);
  }

  const allRows = parseCsv(inputPath);
  const rows = buildIntradayDataset(allRows);
  const baseline = computeStats(rows);

  log(
    `Baseline intradía: count=${baseline.count}, good=${formatPct(baseline.goodRate)}, bad=${formatPct(baseline.badRate)}, neutral=${formatPct(baseline.neutralRate)}`
  );

  const candidates = buildCandidateConditions(rows);
  const singleRules = searchSingleRules(rows, baseline, candidates);

  const seedConditions = [...new Map(singleRules.flatMap(r => r.conditions).map(c => [describeCondition(c), c])).values()];
  log(`Seed conditions intradía para dobles: ${seedConditions.length}`);

  const pairRules = searchPairRules(rows, baseline, seedConditions);

  writeJson("intraday_single.json", singleRules);
  writeJson("intraday_pair.json", pairRules);
  writeJson("intraday_baseline.json", baseline);

  printRules("TOP SINGLE RULES INTRADAY", singleRules, 12);
  printRules("TOP PAIR RULES INTRADAY", pairRules, 12);

  log("Archivos generados:");
  log("- intraday_single.json");
  log("- intraday_pair.json");
  log("- intraday_baseline.json");
}

main();