"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _dotenv = /*#__PURE__*/ _interop_require_wildcard(require("dotenv"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _fs = /*#__PURE__*/ _interop_require_wildcard(require("fs"));
const _chalk = /*#__PURE__*/ _interop_require_default(require("chalk"));
const _indicatorcalculator = require("../../collector/indicator.calculator");
const _candlecache = require("../backtest-simulator/candle-cache");
const _filecache = require("../data-downloader/file-cache");
const _db = require("../backtest-simulator/db");
const _screener = require("../backtest-simulator/screener");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
_dotenv.config({
    path: _path.default.resolve(__dirname, '../../../.env')
});
// ── Config ───────────────────────────────────────────────────────────────────
const MARKET_OPEN_MINUTE = 9 * 60 + 30;
const SCREENER_TOP_N = 40;
const SCREENER_MIN_VOLUME = 500_000;
const SIM_START = '09:30';
const SIM_END = '16:00';
const CSV_HEADER = [
    'symbol',
    'date',
    'candle_time_et',
    'candle_idx',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'atr',
    'vwap',
    'high_of_day',
    'low_of_day',
    'change_pct_at_candle',
    'ema9',
    'ema20',
    'pre_market_high',
    'session',
    'shares_outstanding',
    'market_cap',
    'gap_pct',
    'premarket_volume',
    'momentum_acumulado',
    'change_1m',
    'change_5m',
    'change_10m',
    'minutes_since_hod',
    'future_return_5m',
    'target',
    'target_break_hod_5m',
    'max_future_return_10m'
].join(',');
// ── Helpers ──────────────────────────────────────────────────────────────────
function isWeekday(date) {
    const day = date.getUTCDay();
    return day !== 0 && day !== 6;
}
function getBusinessDays(startDate, endDate) {
    const days = [];
    let current = new Date(startDate + 'T12:00:00Z');
    const end = new Date(endDate + 'T12:00:00Z');
    while(current <= end){
        if (isWeekday(current)) days.push(current.toISOString().slice(0, 10));
        current.setUTCDate(current.getUTCDate() + 1);
    }
    return days;
}
function timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}
function minutesToTime(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function etToUnixMs(dateStr, timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const targetDate = new Date(`${dateStr}T12:00:00Z`);
    const utcStr = targetDate.toLocaleString('en-US', {
        timeZone: 'UTC',
        hour12: false
    });
    const etStr = targetDate.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour12: false
    });
    const utcHour = parseInt(utcStr.split(',')[1].trim().split(':')[0]);
    const etHour = parseInt(etStr.split(',')[1].trim().split(':')[0]);
    let offset = etHour - utcHour;
    if (offset > 12) offset -= 24;
    if (offset < -12) offset += 24;
    return Date.UTC(parseInt(dateStr.slice(0, 4)), parseInt(dateStr.slice(5, 7)) - 1, parseInt(dateStr.slice(8, 10)), h - offset, m, 0);
}
function escapeCsv(val) {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
}
// ── Labels (computed from full-day candles) ──────────────────────────────────
function computeLabels(allCandles, idx) {
    const refClose = allCandles[idx].c;
    if (refClose <= 0) return {
        future_return_5m: 0,
        target: 0,
        target_break_hod_5m: 0,
        max_future_return_10m: 0
    };
    const future5 = allCandles.slice(idx + 1, idx + 6);
    const future10 = allCandles.slice(idx + 1, idx + 11);
    const close5 = future5.length ? future5[future5.length - 1].c : refClose;
    const future_return_5m = (close5 - refClose) / refClose;
    const target = future_return_5m > 0 ? 1 : future_return_5m < 0 ? -1 : 0;
    const maxHigh10 = future10.length ? Math.max(...future10.map((c)=>c.h)) : refClose;
    const max_future_return_10m = (maxHigh10 - refClose) / refClose;
    let hodUpToIdx = -Infinity;
    for(let i = 0; i <= idx; i++)if (allCandles[i].h > hodUpToIdx) hodUpToIdx = allCandles[i].h;
    const target_break_hod_5m = future5.some((c)=>c.h > hodUpToIdx) ? 1 : 0;
    return {
        future_return_5m,
        target,
        target_break_hod_5m,
        max_future_return_10m
    };
}
// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    const startDate = args[0];
    const endDate = args[1] || startDate;
    const outputPath = args[2] || _path.default.resolve(__dirname, '../../../../stock-training/data/training-v2.csv');
    if (!startDate) {
        console.error('Usage: ts-node main.ts START_DATE [END_DATE] [OUTPUT_PATH]');
        process.exit(1);
    }
    const businessDays = getBusinessDays(startDate, endDate);
    console.log(_chalk.default.bgBlue.white.bold('\n  Build Training V2  '));
    console.log(_chalk.default.dim(`  Range: ${startDate} → ${endDate} | Days: ${businessDays.length}`));
    console.log(_chalk.default.dim(`  Output: ${outputPath}\n`));
    const pool = (0, _db.createPool)();
    let profiles;
    try {
        profiles = await (0, _db.getStockProfiles)(pool);
        console.log(_chalk.default.dim(`  Stock profiles: ${profiles.size}`));
    } finally{
        await pool.end();
    }
    // Write CSV header
    const writeStream = _fs.createWriteStream(outputPath, {
        flags: 'w'
    });
    writeStream.write(CSV_HEADER + '\n');
    let totalRows = 0;
    let totalSymbols = 0;
    for(let d = 0; d < businessDays.length; d++){
        const date = businessDays[d];
        const label = `[${d + 1}/${businessDays.length}] ${date}`;
        if (!await (0, _filecache.hasLocalData)(date)) {
            console.log(_chalk.default.yellow(`${label} — no local data, skipping (run download-data first)`));
            continue;
        }
        console.log(_chalk.default.cyan(`${label} — processing...`));
        const allBarsMap = await (0, _filecache.readLocalBars)(date);
        const prevCloseMap = await (0, _filecache.readLocalPrevClose)(date);
        // Convert all bars to candles
        const allCandlesMap = new Map();
        allBarsMap.forEach((bars, sym)=>{
            allCandlesMap.set(sym, (0, _candlecache.alpacaBarsToCandles)(bars));
        });
        // Run screener simulation to find which symbols enter the combined list
        // and WHEN they first enter (to avoid lookahead bias)
        const screener = new _screener.BacktestScreener(SCREENER_TOP_N, SCREENER_MIN_VOLUME);
        const startMin = timeToMinutes(SIM_START);
        const endMin = timeToMinutes(SIM_END);
        const firstSeenAt = new Map(); // symbol → unix ms when first seen
        for(let min = startMin; min <= endMin; min++){
            const currentTime = minutesToTime(min);
            const currentTimeMs = etToUnixMs(date, currentTime);
            const isAfterOpen = min > MARKET_OPEN_MINUTE;
            const candlesUpTo = new Map();
            allCandlesMap.forEach((candles, sym)=>{
                const upTo = candles.filter((c)=>c.t <= currentTimeMs);
                if (upTo.length > 0) candlesUpTo.set(sym, upTo);
            });
            const synthSnapshots = screener.buildSyntheticSnapshots(candlesUpTo, prevCloseMap);
            const { symbols: combinedList } = screener.computeCombinedList(synthSnapshots, date, prevCloseMap, isAfterOpen);
            for (const sym of combinedList){
                if (!firstSeenAt.has(sym)) {
                    firstSeenAt.set(sym, currentTimeMs);
                }
            }
        }
        console.log(_chalk.default.dim(`  Screener found ${firstSeenAt.size} unique symbols`));
        // For each symbol that ever appeared in the combined list, emit ALL its candles
        // (full history from pre-market for correct ATR/EMA/VWAP)
        let dayRows = 0;
        for (const [sym, entryTimeMs] of firstSeenAt){
            const allCandles = allCandlesMap.get(sym);
            if (!allCandles || allCandles.length < 5) continue;
            const prevClose = prevCloseMap.get(sym) ?? 0;
            if (prevClose <= 0) continue;
            const profile = profiles.get(sym);
            const metadata = buildMetadata(allCandles, prevClose, profile);
            for(let i = 0; i < allCandles.length; i++){
                const history = allCandles.slice(0, i + 1);
                const row = (0, _indicatorcalculator.computeCandleRow)(sym, history, metadata);
                const labels = computeLabels(allCandles, i);
                const { time } = (0, _indicatorcalculator.timestampToET)(allCandles[i].t);
                const csvLine = [
                    sym,
                    date,
                    time,
                    i,
                    row.open,
                    row.high,
                    row.low,
                    row.close,
                    row.volume,
                    row.atr,
                    row.vwap,
                    row.high_of_day,
                    row.low_of_day,
                    row.change_pct_at_candle,
                    row.ema9,
                    row.ema20,
                    row.pre_market_high,
                    row.session,
                    row.shares_outstanding,
                    row.market_cap,
                    row.gap_pct,
                    row.premarket_volume,
                    row.momentum_acumulado,
                    row.change_1m,
                    row.change_5m,
                    row.change_10m,
                    row.minutes_since_hod,
                    labels.future_return_5m,
                    labels.target,
                    labels.target_break_hod_5m,
                    labels.max_future_return_10m
                ].map(escapeCsv).join(',');
                writeStream.write(csvLine + '\n');
                dayRows++;
            }
        }
        totalRows += dayRows;
        totalSymbols += firstSeenAt.size;
        console.log(_chalk.default.green(`  ${dayRows} rows from ${firstSeenAt.size} symbols`));
    }
    writeStream.end();
    console.log(_chalk.default.green.bold(`\nDone! ${totalRows} rows, ${totalSymbols} symbol-days → ${outputPath}`));
}
function buildMetadata(candles, prevClose, profile) {
    let preMarketHigh = 0;
    let premarketVolume = 0;
    for (const c of candles){
        const { minuteOfDay } = (0, _indicatorcalculator.timestampToET)(c.t);
        if (minuteOfDay < MARKET_OPEN_MINUTE) {
            if (c.h > preMarketHigh) preMarketHigh = c.h;
            premarketVolume += c.v;
        }
    }
    const firstOpen = candles.length > 0 ? candles[0].o : 0;
    const gapPct = prevClose > 0 ? (firstOpen - prevClose) / prevClose * 100 : 0;
    return {
        priorClose: prevClose,
        preMarketHigh,
        sharesOutstanding: profile?.shares_outstanding ?? null,
        marketCap: profile?.market_cap ?? null,
        gapPct,
        premarketVolume
    };
}
main().catch((err)=>{
    console.error('Fatal error:', err);
    process.exit(1);
});

//# sourceMappingURL=main.js.map