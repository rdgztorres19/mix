"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _dotenv = /*#__PURE__*/ _interop_require_wildcard(require("dotenv"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _chalk = /*#__PURE__*/ _interop_require_default(require("chalk"));
const _alpacaclient = require("../backtest-simulator/alpaca-client");
const _db = require("../backtest-simulator/db");
const _screenerrankers = require("../../scanner/screener/ranking/rankers/screener-rankers");
const _filecache = require("./file-cache");
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
// ── Helpers ──────────────────────────────────────────────────────────────────
function isWeekday(date) {
    const day = date.getUTCDay();
    return day !== 0 && day !== 6;
}
function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}
function getBusinessDays(startDate, endDate) {
    const days = [];
    let current = new Date(startDate + 'T12:00:00Z');
    const end = new Date(endDate + 'T12:00:00Z');
    while(current <= end){
        if (isWeekday(current)) {
            days.push(current.toISOString().slice(0, 10));
        }
        current.setUTCDate(current.getUTCDate() + 1);
    }
    return days;
}
function prevCloseRangeStart(date) {
    // Go back ~10 calendar days to cover holidays + weekends
    return addDays(date, -10);
}
// ── Args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const args = argv.slice(2);
    const startDate = args[0];
    const endDate = args[1] || startDate;
    if (!startDate) {
        console.error('Usage: ts-node main.ts START_DATE [END_DATE]');
        console.error('Example: ts-node main.ts 2026-01-23 2026-01-26');
        process.exit(1);
    }
    return {
        startDate,
        endDate
    };
}
// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const { startDate, endDate } = parseArgs(process.argv);
    const businessDays = getBusinessDays(startDate, endDate);
    console.log(_chalk.default.bgBlue.white.bold('\n  Data Downloader  '));
    console.log(_chalk.default.dim('  Range: ') + _chalk.default.white.bold(`${startDate} → ${endDate}`) + _chalk.default.dim(' | Business days: ') + _chalk.default.white.bold(String(businessDays.length)) + '\n');
    if (!businessDays.length) {
        console.log(_chalk.default.yellow('No business days in range.'));
        return;
    }
    const pool = (0, _db.createPool)();
    const alpacaClient = new _alpacaclient.AlpacaClient();
    try {
        // Load universe
        console.log(_chalk.default.dim('[Init] Loading universe from screener_assets...'));
        const universe = await (0, _db.getUniverseSymbols)(pool);
        console.log(_chalk.default.dim(`  Universe: ${universe.length} symbols\n`));
        for(let d = 0; d < businessDays.length; d++){
            const date = businessDays[d];
            const label = `[${d + 1}/${businessDays.length}] ${date}`;
            // Skip if already downloaded
            if (await (0, _filecache.hasLocalData)(date)) {
                console.log(_chalk.default.green(`${label} — already downloaded, skipping`));
                continue;
            }
            console.log(_chalk.default.cyan.bold(`\n${label} — downloading...`));
            // 1. Fetch 1m bars
            console.log(_chalk.default.dim('  Fetching 1m bars...'));
            const t0 = Date.now();
            const bars1m = await alpacaClient.fetchUniverse1mBars(universe, date);
            const elapsed1m = ((Date.now() - t0) / 1000).toFixed(1);
            console.log(_chalk.default.dim(`  1m bars: ${bars1m.size} symbols (${elapsed1m}s)`));
            // 2. Fetch daily bars for prev_close
            console.log(_chalk.default.dim('  Fetching daily bars for prev_close...'));
            const rangeStart = prevCloseRangeStart(date);
            const t1 = Date.now();
            const dailyBars = await alpacaClient.fetchDailyBarsRange(universe, rangeStart, date);
            const elapsed1d = ((Date.now() - t1) / 1000).toFixed(1);
            console.log(_chalk.default.dim(`  Daily bars: ${dailyBars.size} symbols (${elapsed1d}s)`));
            // 3. Extract prev_close
            const prevCloseMap = new Map();
            dailyBars.forEach((bars, sym)=>{
                const pc = (0, _screenerrankers.barsPrevCloseBeforeSession)(bars, date);
                if (pc != null) prevCloseMap.set(sym, pc);
            });
            console.log(_chalk.default.dim(`  prev_close entries: ${prevCloseMap.size}`));
            // 4. Write to disk
            await (0, _filecache.writeLocalBars)(date, bars1m);
            await (0, _filecache.writeLocalPrevClose)(date, prevCloseMap);
            console.log(_chalk.default.green(`  ${label} — saved to data/${date}/`));
        }
        console.log(_chalk.default.green.bold('\nDone!'));
    } finally{
        await pool.end();
    }
}
main().catch((err)=>{
    console.error('Fatal error:', err);
    process.exit(1);
});

//# sourceMappingURL=main.js.map