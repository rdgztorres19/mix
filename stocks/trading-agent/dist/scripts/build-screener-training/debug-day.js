"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const _dotenv = /*#__PURE__*/ _interop_require_wildcard(require("dotenv"));
const _path = /*#__PURE__*/ _interop_require_default(require("path"));
const _chalk = /*#__PURE__*/ _interop_require_default(require("chalk"));
const _candlecache = require("../backtest-simulator/candle-cache");
const _filecache = require("../data-downloader/file-cache");
const _db = require("../backtest-simulator/db");
const _screener = require("../backtest-simulator/screener");
const _indicatorengine = require("../backtest-simulator/indicator-engine");
const _predictorclient = require("../backtest-simulator/predictor-client");
const _tradesimulator = require("../backtest-simulator/trade-simulator");
const _tradefilters = require("../backtest-simulator/trade-filters");
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
const WIDE_LIMIT = 100;
const SIM_START = '09:30';
const SIM_END = '11:30';
const THRESHOLD = 0.65;
const TARGET_PCT = 4;
const STOP_LOSS_PCT = 2;
const LOOK_AHEAD = 120;
const PARALLEL_MINUTES = 20;
const MAX_SIGNALS_PER_STOCK = 3;
// ── Helpers ──────────────────────────────────────────────────────────────────
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
// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const date = process.argv[2];
    if (!date) {
        console.error('Usage: ts-node debug-day.ts 2026-03-27');
        process.exit(1);
    }
    console.log(_chalk.default.bgMagenta.white.bold(`\n  Debug Wide Screener — ${date}  `));
    console.log(_chalk.default.dim(`  Wide: ${WIDE_LIMIT} | Thr: ${THRESHOLD} | TP: ${TARGET_PCT}% SL: ${STOP_LOSS_PCT}%\n`));
    if (!await (0, _filecache.hasLocalData)(date)) {
        console.error(_chalk.default.red('No local data for this date'));
        process.exit(1);
    }
    const pool = (0, _db.createPool)();
    const profiles = await (0, _db.getStockProfiles)(pool);
    await pool.end();
    const allBarsMap = await (0, _filecache.readLocalBars)(date);
    const prevCloseMap = await (0, _filecache.readLocalPrevClose)(date);
    // Pre-index candles
    const candlesBySymbol = new Map();
    const endTimeMs = etToUnixMs(date, SIM_END);
    for (const [sym, bars] of allBarsMap){
        const candles = (0, _candlecache.alpacaBarsToCandles)(bars);
        if (candles.length === 0) continue;
        let totalVol = 0;
        for (const c of candles){
            if (c.t <= endTimeMs) totalVol += c.v;
        }
        if (totalVol < SCREENER_MIN_VOLUME / 2) continue;
        candles.sort((a, b)=>a.t - b.t);
        candlesBySymbol.set(sym.toUpperCase(), candles);
    }
    console.log(_chalk.default.dim(`  ${candlesBySymbol.size} symbols with candles\n`));
    const screener = new _screener.BacktestScreener(SCREENER_TOP_N, SCREENER_MIN_VOLUME);
    const indicatorEngine = new _indicatorengine.IndicatorEngine();
    const predictorClient = new _predictorclient.PredictorClient();
    const tradeSimulator = new _tradesimulator.TradeSimulator(TARGET_PCT, STOP_LOSS_PCT, LOOK_AHEAD);
    const startMin = timeToMinutes(SIM_START);
    const endMin = timeToMinutes(SIM_END);
    // ── Phase 1a: Wide screener every 5 min ──
    const symbolEntries = new Map();
    const everSeenSymbols = new Set();
    const lastCandleCount = new Map();
    const SCREENER_INTERVAL = 5;
    const screenerMinutes = [];
    for(let min = startMin; min <= endMin; min += SCREENER_INTERVAL)screenerMinutes.push(min);
    if (screenerMinutes[screenerMinutes.length - 1] !== endMin) screenerMinutes.push(endMin);
    for (const min of screenerMinutes){
        const currentTime = minutesToTime(min);
        const currentTimeMs = etToUnixMs(date, currentTime);
        const isAfterOpen = min > MARKET_OPEN_MINUTE;
        const filteredCandles = new Map();
        for (const [sym, candles] of candlesBySymbol){
            let lo = 0, hi = candles.length;
            while(lo < hi){
                const mid = lo + hi >>> 1;
                if (candles[mid].t <= currentTimeMs) lo = mid + 1;
                else hi = mid;
            }
            if (lo > 0) filteredCandles.set(sym, candles.slice(0, lo));
        }
        const synthSnapshots = screener.buildSyntheticSnapshots(filteredCandles, prevCloseMap);
        const wide = screener.computeCombinedListWide(synthSnapshots, date, prevCloseMap, isAfterOpen, WIDE_LIMIT);
        for(let rank = 0; rank < wide.symbols.length; rank++){
            const sym = wide.symbols[rank];
            if (symbolEntries.has(sym)) continue;
            everSeenSymbols.add(sym);
            const history = filteredCandles.get(sym) ?? [];
            if (history.length < 2) continue;
            const prevClose = prevCloseMap.get(sym) ?? 0;
            if (prevClose <= 0) continue;
            const profile = profiles.get(sym);
            const metadata = indicatorEngine.buildMetadata(history, prevClose, profile);
            const row = indicatorEngine.buildRow(sym, history, metadata);
            const last = history[history.length - 1];
            const price = last.c;
            const atrPct = price > 0 && row.atr ? row.atr / price * 100 : 0;
            let hod = -Infinity;
            for (const c of history)if (c.h > hod) hod = c.h;
            const distHodPct = hod > 0 ? (price - hod) / hod * 100 : 0;
            symbolEntries.set(sym, {
                price,
                gapPct: metadata.gapPct ?? 0,
                premarketVolume: metadata.premarketVolume ?? 0,
                atrPct,
                distHodPct,
                timeOfFirstEntryMin: min,
                reasons: wide.reasons.get(sym) ?? new Set(),
                combinedRank: rank,
                totalSignals: 0,
                wins: 0,
                losses: 0,
                neutrals: 0,
                totalPnl: 0,
                trades: []
            });
        }
    }
    console.log(_chalk.default.cyan(`  Phase 1: ${symbolEntries.size} symbols in wide screener\n`));
    const minuteDataList = [];
    for(let min = startMin; min <= endMin; min++){
        const currentTime = minutesToTime(min);
        const currentTimeMs = etToUnixMs(date, currentTime);
        const payloads = [];
        for (const symbol of everSeenSymbols){
            // No lookahead: only generate payloads from when the stock entered the screener
            const entry = symbolEntries.get(symbol);
            if (!entry || min < entry.timeOfFirstEntryMin) continue;
            const symCandles = candlesBySymbol.get(symbol);
            if (!symCandles) continue;
            let lo = 0, hi = symCandles.length;
            while(lo < hi){
                const mid = lo + hi >>> 1;
                if (symCandles[mid].t <= currentTimeMs) lo = mid + 1;
                else hi = mid;
            }
            if (lo < 2) continue;
            const prevCount = lastCandleCount.get(symbol) ?? 0;
            if (lo === prevCount) continue;
            lastCandleCount.set(symbol, lo);
            const history = symCandles.slice(0, lo);
            const prevClose = prevCloseMap.get(symbol) ?? 0;
            if (prevClose <= 0) continue;
            const meta = indicatorEngine.buildMetadata(history, prevClose, profiles.get(symbol));
            const row = indicatorEngine.buildRow(symbol, history, meta);
            const payload = indicatorEngine.buildPredictPayload(row, history);
            payloads.push({
                symbol,
                payload
            });
        }
        minuteDataList.push({
            min,
            time: currentTime,
            timeMs: currentTimeMs,
            payloads
        });
    }
    const totalPayloads = minuteDataList.reduce((s, m)=>s + m.payloads.length, 0);
    console.log(_chalk.default.cyan(`  Phase 1b: ${totalPayloads} payloads\n`));
    // ── Phase 2: Predict ──
    const minuteResults = [];
    const signalsPerStock = new Map();
    for(let batch = 0; batch < minuteDataList.length; batch += PARALLEL_MINUTES){
        const chunk = minuteDataList.slice(batch, batch + PARALLEL_MINUTES);
        const promises = chunk.map(async (md, chunkIdx)=>{
            let predictions = [];
            if (md.payloads.length > 0) {
                try {
                    predictions = await predictorClient.predictBatch(md.payloads.map((p)=>p.payload), THRESHOLD);
                } catch  {
                    predictions = md.payloads.map(()=>({
                            tradeable: false,
                            prob: 0,
                            threshold: THRESHOLD
                        }));
                }
            }
            return {
                idx: batch + chunkIdx,
                predictions
            };
        });
        minuteResults.push(...await Promise.all(promises));
    }
    minuteResults.sort((a, b)=>a.idx - b.idx);
    // ── Phase 3: Evaluate trades ──
    for(let i = 0; i < minuteDataList.length; i++){
        const md = minuteDataList[i];
        const predictions = minuteResults[i]?.predictions ?? [];
        for(let j = 0; j < md.payloads.length; j++){
            const { symbol } = md.payloads[j];
            const pred = predictions[j] ?? {
                tradeable: false,
                prob: 0,
                threshold: THRESHOLD
            };
            if (!pred.tradeable) continue;
            const entry = symbolEntries.get(symbol);
            if (!entry) continue;
            const symCandles = candlesBySymbol.get(symbol);
            const history = symCandles ? symCandles.filter((c)=>c.t <= md.timeMs) : [];
            const prevClose = prevCloseMap.get(symbol) ?? 0;
            const profile = profiles.get(symbol);
            const metadata = indicatorEngine.buildMetadata(history, prevClose, profile);
            const ctx = (0, _tradefilters.buildTradeContext)(symbol, pred.prob, history, prevClose, profile?.shares_outstanding ?? 0, metadata.premarketVolume, metadata.gapPct);
            const { pass } = (0, _tradefilters.applyFilters)(ctx);
            if (!pass) continue;
            const symSignalCount = signalsPerStock.get(symbol) ?? 0;
            if (symSignalCount >= MAX_SIGNALS_PER_STOCK) continue;
            signalsPerStock.set(symbol, symSignalCount + 1);
            const allCandles = candlesBySymbol.get(symbol) ?? [];
            const entryIdx = history.length - 1;
            const trade = tradeSimulator.evaluate(allCandles, entryIdx);
            entry.totalSignals++;
            if (trade.result === 'win') {
                entry.wins++;
                entry.totalPnl += trade.pnlPct;
            } else if (trade.result === 'loss') {
                entry.losses++;
                entry.totalPnl += trade.pnlPct;
            } else {
                entry.neutrals++;
            }
            entry.trades.push({
                time: md.time,
                prob: pred.prob,
                result: trade.result,
                pnl: trade.pnlPct
            });
        }
    }
    // ── Results ──
    const allEntries = [
        ...symbolEntries.entries()
    ];
    const withSignals = allEntries.filter(([, e])=>e.totalSignals > 0);
    const totalWins = withSignals.reduce((s, [, e])=>s + e.wins, 0);
    const totalLosses = withSignals.reduce((s, [, e])=>s + e.losses, 0);
    const totalNeutrals = withSignals.reduce((s, [, e])=>s + e.neutrals, 0);
    const totalSig = totalWins + totalLosses + totalNeutrals;
    const wr = totalSig > 0 ? totalWins / (totalWins + totalLosses) * 100 : 0;
    console.log(_chalk.default.bgCyan.black.bold(`\n  RESULTS — ${date} (Wide Screener top ${WIDE_LIMIT})  \n`));
    console.log(_chalk.default.white(`  Symbols: ${symbolEntries.size} total, ${withSignals.length} with signals`));
    console.log(_chalk.default.white(`  Signals: ${totalSig} | `) + _chalk.default.green(`${totalWins}W`) + _chalk.default.dim(' / ') + _chalk.default.red(`${totalLosses}L`) + _chalk.default.dim(' / ') + _chalk.default.yellow(`${totalNeutrals}N`) + _chalk.default.dim(` | WR: `) + _chalk.default.white.bold(`${wr.toFixed(1)}%`));
    const totalPnl = withSignals.reduce((s, [, e])=>s + e.totalPnl, 0);
    console.log(_chalk.default.dim(`  Total PnL: `) + (totalPnl >= 0 ? _chalk.default.green : _chalk.default.red)(`${totalPnl.toFixed(2)}%`));
    // Sort by total_pnl descending
    withSignals.sort((a, b)=>b[1].totalPnl - a[1].totalPnl);
    console.log(_chalk.default.dim(`\n  ${'─'.repeat(110)}`));
    console.log(_chalk.default.dim(`  ${'Symbol'.padEnd(8)} ${'Price'.padStart(7)} ${'Gap%'.padStart(6)} ${'Rank'.padStart(4)} ${'Seen'.padStart(5)} ${'Sig'.padStart(3)} ${'W'.padStart(2)} ${'L'.padStart(2)} ${'N'.padStart(2)} ${'WR%'.padStart(5)} ${'PnL'.padStart(7)} ${'Rankings'.padEnd(20)} Trades`));
    console.log(_chalk.default.dim(`  ${'─'.repeat(110)}`));
    for (const [sym, e] of withSignals){
        const wr = e.totalSignals > 0 ? e.wins / (e.wins + e.losses || 1) * 100 : 0;
        const pnlColor = e.totalPnl > 0 ? _chalk.default.green : e.totalPnl < 0 ? _chalk.default.red : _chalk.default.dim;
        const wrColor = wr >= 50 ? _chalk.default.green : _chalk.default.red;
        const rankings = [
            ...e.reasons
        ].join(',');
        const time = minutesToTime(e.timeOfFirstEntryMin);
        const trades = e.trades.map((t)=>{
            const rc = t.result === 'win' ? _chalk.default.green('W') : t.result === 'loss' ? _chalk.default.red('L') : _chalk.default.yellow('N');
            return `${t.time}(${rc})`;
        }).join(' ');
        console.log(`  ${_chalk.default.white(sym.padEnd(8))} ` + `${_chalk.default.dim(e.price.toFixed(2).padStart(7))} ` + `${_chalk.default.dim(e.gapPct.toFixed(1).padStart(6))} ` + `${_chalk.default.dim(String(e.combinedRank).padStart(4))} ` + `${_chalk.default.dim(time.padStart(5))} ` + `${String(e.totalSignals).padStart(3)} ` + `${_chalk.default.green(String(e.wins).padStart(2))} ` + `${_chalk.default.red(String(e.losses).padStart(2))} ` + `${_chalk.default.yellow(String(e.neutrals).padStart(2))} ` + `${wrColor(wr.toFixed(0).padStart(4))}% ` + `${pnlColor(e.totalPnl.toFixed(1).padStart(7))} ` + `${_chalk.default.dim(rankings.padEnd(20))} ` + trades);
    }
    // Also show stocks WITHOUT signals (screener picked them but predict model didn't trigger)
    const noSignals = allEntries.filter(([, e])=>e.totalSignals === 0);
    console.log(_chalk.default.dim(`\n  ${noSignals.length} stocks in wide screener WITHOUT signals (predict model didn't trigger)`));
}
main().catch((err)=>{
    console.error('Fatal:', err);
    process.exit(1);
});

//# sourceMappingURL=debug-day.js.map