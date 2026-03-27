"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _dotenv = /*#__PURE__*/ _interop_require_wildcard(require("dotenv"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _config = require("./config");
const _db = require("./db");
const _alpacaclient = require("./alpaca-client");
const _candlecache = require("./candle-cache");
const _screener = require("./screener");
const _indicatorengine = require("./indicator-engine");
const _predictorclient = require("./predictor-client");
const _tradesimulator = require("./trade-simulator");
const _logger = require("./logger");
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
// Load .env from trading-agent root
_dotenv.config({
    path: _path.default.resolve(__dirname, '../../../.env')
});
const MARKET_OPEN_MINUTE = 9 * 60 + 30;
/**
 * Convert a date string + HH:MM time in ET to unix ms.
 * Uses America/New_York timezone.
 */ function etToUnixMs(dateStr, timeStr) {
    // Build an ISO-like string and parse in ET
    const [h, m] = timeStr.split(':').map(Number);
    // Create date in UTC, then adjust for ET offset
    const naive = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
    // Use Intl to find the ET offset for this date
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    // Binary search for the correct ms that maps to the desired ET time
    // Simple approach: assume ET is UTC-4 or UTC-5
    const jan = new Date(`${dateStr.slice(0, 4)}-01-15T12:00:00Z`);
    const jul = new Date(`${dateStr.slice(0, 4)}-07-15T12:00:00Z`);
    const janOffset = getETOffset(jan);
    const targetDate = new Date(`${dateStr}T12:00:00Z`);
    const offset = getETOffset(targetDate);
    // ET time = UTC time + offset (offset is negative, e.g., -4 or -5)
    // So UTC = ET - offset => UTC = ET + |offset|
    const utcMs = Date.UTC(parseInt(dateStr.slice(0, 4)), parseInt(dateStr.slice(5, 7)) - 1, parseInt(dateStr.slice(8, 10)), h - offset, m, 0);
    return utcMs;
}
function getETOffset(date) {
    const utcStr = date.toLocaleString('en-US', {
        timeZone: 'UTC',
        hour12: false
    });
    const etStr = date.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour12: false
    });
    const utcHour = parseInt(utcStr.split(',')[1].trim().split(':')[0]);
    const etHour = parseInt(etStr.split(',')[1].trim().split(':')[0]);
    let diff = etHour - utcHour;
    if (diff > 12) diff -= 24;
    if (diff < -12) diff += 24;
    return diff;
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
async function main() {
    const config = (0, _config.parseArgs)(process.argv);
    console.log(`\nBacktest Simulator`);
    console.log(`Date: ${config.date} | Time: ${config.startTime}-${config.endTime}`);
    console.log(`Threshold: ${config.threshold} | TP: ${config.targetPct}% | SL: ${config.stopLossPct}%\n`);
    // 1. Initialize services
    const pool = (0, _db.createPool)();
    const alpacaClient = new _alpacaclient.AlpacaClient();
    const candleCache = new _candlecache.CandleCache();
    const screener = new _screener.BacktestScreener(40, 1_000_000);
    const indicatorEngine = new _indicatorengine.IndicatorEngine();
    const predictorClient = new _predictorclient.PredictorClient();
    const tradeSimulator = new _tradesimulator.TradeSimulator(config.targetPct, config.stopLossPct, 60);
    const logger = new _logger.SimLogger();
    try {
        // 2. Load data from DB
        console.log('[Init] Loading universe from screener_assets...');
        const universe = await (0, _db.getUniverseSymbols)(pool);
        console.log(`  Universe: ${universe.length} symbols`);
        console.log('[Init] Loading prev_close map...');
        const prevCloseMap = await (0, _db.getPrevCloseMap)(pool, config.date);
        console.log(`  Prev close entries: ${prevCloseMap.size}`);
        console.log('[Init] Loading stock profiles...');
        const profiles = await (0, _db.getStockProfiles)(pool);
        console.log(`  Stock profiles: ${profiles.size}`);
        // 3. Fetch daily bars for the full universe (for screener rankings)
        // Only fetch symbols that have prev_close data (meaningful for gap calculation)
        const symbolsWithPrev = universe.filter((s)=>prevCloseMap.has(s));
        console.log(`\n[Init] Fetching daily bars for ${symbolsWithPrev.length} symbols with prev_close...`);
        const dailyBars = await alpacaClient.fetchDailyBars(symbolsWithPrev, config.date);
        console.log(`  Daily bars received for ${dailyBars.size} symbols`);
        // 4. Build initial daily snapshots for screener
        const dailySnapshots = screener.buildSnapshotsFromDailyBars(dailyBars, prevCloseMap);
        // 5. Run minute-by-minute simulation
        const startMin = timeToMinutes(config.startTime);
        const endMin = timeToMinutes(config.endTime);
        console.log(`\n[Sim] Starting simulation from ${config.startTime} to ${config.endTime}...`);
        for(let min = startMin; min <= endMin; min++){
            const currentTime = minutesToTime(min);
            const currentTimeMs = etToUnixMs(config.date, currentTime);
            const isAfterOpen = min > MARKET_OPEN_MINUTE;
            // 5a. Build synthetic snapshots (merge daily + 1m where available)
            const synthSnapshots = screener.buildSyntheticSnapshots(new Map(candleCache.symbols.map((s)=>[
                    s,
                    candleCache.getCandlesUpTo(s, currentTimeMs)
                ])), currentTimeMs, prevCloseMap, dailySnapshots);
            // 5b. Compute combined list + reasons
            const { symbols: combinedList, reasons } = screener.computeCombinedList(synthSnapshots, config.date, prevCloseMap, isAfterOpen);
            // 5c. Ensure 1m bars cached for combined list symbols
            await candleCache.ensureSymbols(combinedList, config.date, alpacaClient);
            // 5d. Build indicators + predict payloads for each symbol
            const payloads = [];
            for (const symbol of combinedList){
                const history = candleCache.getCandlesUpTo(symbol, currentTimeMs);
                if (history.length < 2) continue;
                const prevClose = prevCloseMap.get(symbol) ?? 0;
                if (prevClose <= 0) continue;
                const metadata = indicatorEngine.buildMetadata(history, prevClose, profiles.get(symbol));
                const row = indicatorEngine.buildRow(symbol, history, metadata);
                const payload = indicatorEngine.buildPredictPayload(row, history);
                payloads.push({
                    symbol,
                    payload
                });
            }
            // 5e. Batch predict
            let predictions = [];
            if (payloads.length > 0) {
                try {
                    predictions = await predictorClient.predictBatch(payloads.map((p)=>p.payload), config.threshold);
                } catch (err) {
                    console.error(`  [Predict] Error at ${currentTime}:`, err.message);
                    predictions = payloads.map(()=>({
                            tradeable: false,
                            prob: 0,
                            threshold: config.threshold
                        }));
                }
            }
            // 5f. Evaluate trades for BUY signals
            const minuteSignals = [];
            for(let i = 0; i < payloads.length; i++){
                const { symbol } = payloads[i];
                const pred = predictions[i] ?? {
                    tradeable: false,
                    prob: 0,
                    threshold: config.threshold
                };
                if (pred.tradeable) {
                    // Find entry candle index in full day bars
                    const allCandles = candleCache.getAllCandles(symbol);
                    const history = candleCache.getCandlesUpTo(symbol, currentTimeMs);
                    const entryIdx = history.length - 1;
                    // Look-ahead evaluation
                    const trade = tradeSimulator.evaluate(allCandles, entryIdx);
                    minuteSignals.push({
                        symbol,
                        prob: pred.prob,
                        tradeable: true,
                        trade
                    });
                } else {
                    minuteSignals.push({
                        symbol,
                        prob: pred.prob,
                        tradeable: false
                    });
                }
            }
            // 5g. Log minute results
            logger.logMinute(currentTime, combinedList, reasons, minuteSignals);
        }
        // 6. Final summary
        logger.printSummary(config);
    } finally{
        await pool.end();
    }
}
main().catch((err)=>{
    console.error('Fatal error:', err);
    process.exit(1);
});

//# sourceMappingURL=main.js.map