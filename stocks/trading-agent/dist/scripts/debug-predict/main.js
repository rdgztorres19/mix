"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _dotenv = /*#__PURE__*/ _interop_require_wildcard(require("dotenv"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _chalk = /*#__PURE__*/ _interop_require_default(require("chalk"));
const _indicatorcalculator = require("../../collector/indicator.calculator");
const _alpacaclient = require("../backtest-simulator/alpaca-client");
const _candlecache = require("../backtest-simulator/candle-cache");
const _barscache = require("../backtest-simulator/bars-cache");
const _db = require("../backtest-simulator/db");
const _indicatorengine = require("../backtest-simulator/indicator-engine");
const _predictorclient = require("../backtest-simulator/predictor-client");
const _tradesimulator = require("../backtest-simulator/trade-simulator");
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
// ── Args ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const args = argv.slice(2);
    const symbol = (args[0] || '').toUpperCase();
    if (!symbol) {
        console.error('Usage: ts-node main.ts SYMBOL DATE [fromTime] [toTime] [threshold] [tp] [sl]');
        console.error('Example: ts-node main.ts MDAI 2026-03-19 09:30 11:00 0.65 4 2');
        process.exit(1);
    }
    return {
        symbol,
        date: args[1] || todayNY(),
        fromTime: args[2] || '09:30',
        toTime: args[3] || '11:00',
        threshold: parseFloat(args[4]) || 0.65,
        targetPct: parseFloat(args[5]) || 4,
        stopLossPct: parseFloat(args[6]) || 2
    };
}
function todayNY() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}
function timeToMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}
// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const config = parseArgs(process.argv);
    const { symbol, date, fromTime, toTime, threshold, targetPct, stopLossPct } = config;
    const logger = new _logger.DebugPredictLogger(threshold, targetPct, stopLossPct);
    logger.printHeader(symbol, date, fromTime, toTime);
    const indicatorEngine = new _indicatorengine.IndicatorEngine();
    const predictorClient = new _predictorclient.PredictorClient();
    const tradeSimulator = new _tradesimulator.TradeSimulator(targetPct, stopLossPct, 120);
    const pool = (0, _db.createPool)();
    let redis = null;
    try {
        // 1. Load prev_close and stock profile from DB
        console.log(_chalk.default.dim('[Init] Loading prev_close and stock profiles...'));
        const [prevCloseMap, profiles] = await Promise.all([
            (0, _db.getPrevCloseMap)(pool, date),
            (0, _db.getStockProfiles)(pool)
        ]);
        const prevClose = prevCloseMap.get(symbol) ?? 0;
        const profile = profiles.get(symbol);
        console.log(_chalk.default.dim('  prev_close: ') + _chalk.default.white(prevClose > 0 ? prevClose.toFixed(2) : 'N/A') + _chalk.default.dim(' | profile: ') + _chalk.default.white(profile ? `shares=${profile.shares_outstanding}` : 'N/A'));
        // 2. Fetch 1m bars (Redis cache or Alpaca)
        let bars;
        try {
            redis = await (0, _barscache.connectRedis)();
            const cached = await (0, _barscache.getCachedBars)(redis, date);
            if (cached) {
                const symbolBars = cached.get(symbol);
                if (symbolBars && symbolBars.length > 0) {
                    bars = symbolBars;
                    console.log(_chalk.default.green(`[Redis] Cache hit: ${bars.length} bars for ${symbol}`));
                } else {
                    console.log(_chalk.default.yellow(`[Redis] Cache exists but no bars for ${symbol}, fetching from Alpaca...`));
                }
            } else {
                console.log(_chalk.default.yellow(`[Redis] No cache for ${date}, fetching from Alpaca...`));
            }
        } catch  {
            console.log(_chalk.default.yellow('[Redis] Unavailable, fetching from Alpaca...'));
        }
        if (!bars) {
            const alpacaClient = new _alpacaclient.AlpacaClient();
            const barsMap = await alpacaClient.fetch1mBars([
                symbol
            ], date);
            bars = barsMap.get(symbol) ?? [];
        }
        if (!bars.length) {
            console.error(_chalk.default.red(`No bars found for ${symbol} on ${date}`));
            process.exit(1);
        }
        // 3. Convert to CollectorCandle[]
        const allCandles = (0, _candlecache.alpacaBarsToCandles)(bars);
        console.log(_chalk.default.dim(`  Total candles: ${allCandles.length}\n`));
        // 4. Filter candles in the target time range and build payloads
        const fromMin = timeToMinutes(fromTime);
        const toMin = timeToMinutes(toTime);
        const targetIndices = [];
        for(let i = 0; i < allCandles.length; i++){
            const { minuteOfDay } = (0, _indicatorcalculator.timestampToET)(allCandles[i].t);
            if (minuteOfDay >= fromMin && minuteOfDay <= toMin) {
                targetIndices.push(i);
            }
        }
        if (!targetIndices.length) {
            console.error(_chalk.default.red(`No candles in ${fromTime}-${toTime} range`));
            process.exit(1);
        }
        console.log(_chalk.default.dim(`[Predict] Building ${targetIndices.length} payloads...`));
        const payloads = [];
        for (const idx of targetIndices){
            const history = allCandles.slice(0, idx + 1);
            if (history.length < 2) continue;
            const metadata = indicatorEngine.buildMetadata(history, prevClose, profile);
            const row = indicatorEngine.buildRow(symbol, history, metadata);
            const payload = indicatorEngine.buildPredictPayload(row, history);
            payloads.push(payload);
        }
        // 5. Batch predict
        console.log(_chalk.default.dim(`[Predict] Calling predict_batch with ${payloads.length} payloads...`));
        const results = await predictorClient.predictBatch(payloads, threshold);
        // 6. Build signals for the logger
        const signals = [];
        const tpDec = targetPct / 100;
        for(let i = 0; i < targetIndices.length; i++){
            const idx = targetIndices[i];
            const candle = allCandles[idx];
            const { time } = (0, _indicatorcalculator.timestampToET)(candle.t);
            const pred = results[i] ?? {
                tradeable: false,
                prob: 0,
                threshold
            };
            // max_future_return_10m (look-ahead)
            const future10 = allCandles.slice(idx + 1, idx + 11);
            const entryPrice = candle.c;
            let mfr10m = 0;
            if (future10.length > 0 && entryPrice > 0) {
                const maxHigh = Math.max(...future10.map((c)=>c.h));
                mfr10m = (maxHigh - entryPrice) / entryPrice;
            }
            // Trade evaluation (if tradeable)
            let trade;
            if (pred.tradeable) {
                trade = tradeSimulator.evaluate(allCandles, idx);
            }
            signals.push({
                time,
                open: candle.o,
                high: candle.h,
                low: candle.l,
                close: candle.c,
                volume: candle.v,
                prob: pred.prob,
                tradeable: pred.tradeable,
                mfr10m,
                trade
            });
        }
        // 7. Print results
        logger.printTable(signals);
    } finally{
        redis?.disconnect();
        await pool.end();
    }
}
main().catch((err)=>{
    console.error('Fatal error:', err);
    process.exit(1);
});

//# sourceMappingURL=main.js.map