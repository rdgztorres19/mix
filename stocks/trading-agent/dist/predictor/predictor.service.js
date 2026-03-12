"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "PredictorService", {
    enumerable: true,
    get: function() {
        return PredictorService;
    }
});
const _common = require("@nestjs/common");
const _child_process = require("child_process");
const _path = /*#__PURE__*/ _interop_require_wildcard(require("path"));
const _rxjs = require("rxjs");
const _mysqltrainingrepository = require("../scanner/mysql/mysql-training.repository");
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
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let PredictorService = class PredictorService {
    async evaluate(threshold = 0.5) {
        return new Promise((resolve, reject)=>{
            const proc = (0, _child_process.spawn)('python3', [
                this.evaluateScriptPath,
                '--json',
                '--threshold',
                String(threshold)
            ], {
                cwd: _path.dirname(this.evaluateScriptPath),
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ]
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk)=>{
                stdout += chunk.toString();
            });
            proc.stderr.on('data', (chunk)=>{
                stderr += chunk.toString();
            });
            proc.on('error', (err)=>{
                this.logger.error(`Evaluate spawn error: ${err.message}`);
                reject(err);
            });
            proc.on('close', (code)=>{
                if (code !== 0) {
                    this.logger.warn(`Evaluate script exit ${code}: ${stderr}`);
                    reject(new Error(stderr || `Evaluate failed with code ${code}`));
                    return;
                }
                try {
                    resolve(JSON.parse(stdout));
                } catch  {
                    reject(new Error(`Invalid evaluate output: ${stdout}`));
                }
            });
        });
    }
    async predict(features, threshold = 0.3) {
        let payload;
        if (features.ticker && features.date && features.candle_time_et) {
            // Historical mode: fetch candle data from MySQL, convert to candles array for Python
            const rows = await this.mysqlRepo.getTickerRowsForDate(features.ticker, features.date, '1m');
            if (!rows.length) {
                return {
                    tradeable: false,
                    prob: 0,
                    threshold,
                    error: `No data for ${features.ticker} on ${features.date}`
                };
            }
            // Find target row index by candle_time_et
            let targetIdx = rows.length - 1;
            for(let i = 0; i < rows.length; i++){
                if (String(rows[i].candle_time_et) === features.candle_time_et) {
                    targetIdx = i;
                }
            }
            // Convert MySQL rows to candle format for Python
            const candles = rows.map((r, i)=>({
                    t: i,
                    o: Number(r.open ?? 0),
                    h: Number(r.high ?? 0),
                    l: Number(r.low ?? 0),
                    c: Number(r.close ?? 0),
                    v: Number(r.volume ?? 0)
                }));
            // Pass candle_time_et and candle_idx arrays from MySQL so Python can
            // derive correct time-based and index-based features
            const candleTimesEt = rows.map((r)=>String(r.candle_time_et ?? '09:30'));
            const candleIdxArr = rows.map((r)=>Number(r.candle_idx ?? 0));
            // Pass along key metadata from the MySQL rows
            const targetRow = rows[targetIdx];
            payload = {
                candles,
                target_idx: targetIdx,
                candle_times_et: candleTimesEt,
                candle_idx_arr: candleIdxArr,
                atr: Number(targetRow.atr ?? 0),
                high_of_day: Number(targetRow.high_of_day ?? 0),
                low_of_day: Number(targetRow.low_of_day ?? 0),
                pre_market_high: Number(targetRow.pre_market_high ?? 0),
                change_pct_at_candle: Number(targetRow.change_pct_at_candle ?? 0),
                // Pass enriched columns that MySQL already has (so Python doesn't recompute)
                shares_outstanding: Number(targetRow.shares_outstanding ?? 0),
                market_cap: Number(targetRow.market_cap ?? 0),
                gap_pct: Number(targetRow.gap_pct ?? 0),
                premarket_volume: Number(targetRow.premarket_volume ?? 0),
                _threshold: threshold
            };
            this.logger.log(`Historical predict: ${features.ticker} ${features.date} ${features.candle_time_et} (${rows.length} candles, target=${targetIdx})`);
        } else {
            // Live mode: pass through candles array as-is
            payload = {
                ...features,
                _threshold: threshold
            };
        }
        const input = JSON.stringify(payload);
        return new Promise((resolve, reject)=>{
            const proc = (0, _child_process.spawn)('python3', [
                this.scriptPath
            ], {
                cwd: _path.dirname(this.scriptPath),
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ]
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk)=>{
                stdout += chunk.toString();
            });
            proc.stderr.on('data', (chunk)=>{
                stderr += chunk.toString();
            });
            proc.on('error', (err)=>{
                this.logger.error(`Predict spawn error: ${err.message}`);
                reject(err);
            });
            proc.on('close', (code)=>{
                if (code !== 0) {
                    this.logger.warn(`Predict script exit ${code}: ${stderr}`);
                }
                try {
                    const result = JSON.parse(stdout);
                    if (result.error) {
                        reject(new Error(result.error));
                    } else {
                        resolve(result);
                    }
                } catch  {
                    reject(new Error(`Invalid predict output: ${stdout}`));
                }
            });
            proc.stdin.write(input, ()=>proc.stdin.end());
        });
    }
    // ─── Helpers ───────────────────────────────────────────────────────────
    /**
   * Simulate: did price hit +TP% before -SL% in next 10 candles?
   * Returns tpSlResult plus exitPrice/exitTime when TP or SL is hit.
   */ computeTpSlExit(rows, idx, tpPct, slPct) {
        const refClose = Number(rows[idx]?.close ?? 0);
        if (refClose <= 0) return {
            tpSlResult: 'neutral'
        };
        const levelUp = refClose * (1 + tpPct);
        const levelDown = refClose * (1 - slPct);
        let prevClose = refClose;
        for(let j = 1; j <= Math.min(10, rows.length - idx - 1); j++){
            const r = rows[idx + j];
            if (!r) break;
            const openJ = Number(r.open ?? 0);
            const highJ = Number(r.high ?? 0);
            const lowJ = Number(r.low ?? 0);
            const closeJ = Number(r.close ?? 0);
            if (prevClose < openJ && prevClose < levelUp && levelUp < openJ) {
                return {
                    tpSlResult: 'win',
                    exitPrice: levelUp,
                    exitTime: String(r.candle_time_et ?? '')
                };
            }
            if (prevClose > openJ && openJ < levelDown && levelDown < prevClose) {
                return {
                    tpSlResult: 'loss',
                    exitPrice: levelDown,
                    exitTime: String(r.candle_time_et ?? '')
                };
            }
            const touchUp = highJ >= levelUp;
            const touchDown = lowJ <= levelDown;
            if (touchUp && touchDown) {
                const hit = closeJ >= openJ ? 'loss' : 'win';
                const price = closeJ >= openJ ? levelDown : levelUp;
                return {
                    tpSlResult: hit,
                    exitPrice: price,
                    exitTime: String(r.candle_time_et ?? '')
                };
            }
            if (touchUp) return {
                tpSlResult: 'win',
                exitPrice: levelUp,
                exitTime: String(r.candle_time_et ?? '')
            };
            if (touchDown) return {
                tpSlResult: 'loss',
                exitPrice: levelDown,
                exitTime: String(r.candle_time_et ?? '')
            };
            prevClose = closeJ;
        }
        return {
            tpSlResult: 'neutral'
        };
    }
    /**
   * Compute max_future_return_10m on-the-fly when DB value is null.
   * Returns mfr plus exitPrice/exitTime when future candles are available.
   * (max(high[t+1..t+10]) - close[t]) / close[t]
   */ computeMfr(rows, idx) {
        const closeT = Number(rows[idx].close ?? 0);
        const canScan = closeT > 0 && idx + 10 < rows.length;
        if (canScan) {
            let maxHigh = 0;
            let exitIdx = -1;
            for(let j = idx + 1; j <= idx + 10; j++){
                const h = Number(rows[j]?.high ?? 0);
                if (h > maxHigh) {
                    maxHigh = h;
                    exitIdx = j;
                }
            }
            const mfr = (maxHigh - closeT) / closeT;
            return {
                mfr,
                exitPrice: maxHigh,
                exitTime: exitIdx >= 0 ? String(rows[exitIdx]?.candle_time_et ?? '') : undefined
            };
        }
        const dbVal = rows[idx].max_future_return_10m;
        const mfr = dbVal != null ? Number(dbVal) : 0;
        return {
            mfr
        };
    }
    // ─── Backtest: candle-by-candle predict over a date/time range ─────────
    async backtest(ticker, dateStr, fromTime, toTime, threshold, investment) {
        const rows = await this.mysqlRepo.getTickerRowsForDate(ticker.toUpperCase(), dateStr, '1m');
        if (!rows.length) {
            return {
                rows: [],
                summary: null,
                error: `No data for ${ticker} on ${dateStr}`
            };
        }
        const toMin = (t)=>{
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };
        const fromMin = toMin(fromTime);
        const toMinVal = toMin(toTime);
        const allCandles = rows.map((r, i)=>({
                t: i,
                o: Number(r.open ?? 0),
                h: Number(r.high ?? 0),
                l: Number(r.low ?? 0),
                c: Number(r.close ?? 0),
                v: Number(r.volume ?? 0)
            }));
        const candleTimesEt = rows.map((r)=>String(r.candle_time_et ?? '09:30'));
        const candleIdxArr = rows.map((r)=>Number(r.candle_idx ?? 0));
        // Filter rows in time window
        const targets = [];
        for(let i = 0; i < rows.length; i++){
            const t = String(rows[i].candle_time_et ?? '');
            const m = toMin(t);
            if (m >= fromMin && m <= toMinVal) {
                targets.push({
                    idx: i,
                    time: t
                });
            }
        }
        if (!targets.length) {
            return {
                rows: [],
                summary: null,
                error: `No candles in ${fromTime}–${toTime}`
            };
        }
        let tp = 0, fp = 0, tn = 0, fn = 0;
        let cumPnL = 0;
        const resultRows = [];
        for (const { idx, time } of targets){
            const targetRow = rows[idx];
            const payload = {
                candles: allCandles.slice(0, idx + 1),
                target_idx: idx,
                candle_times_et: candleTimesEt.slice(0, idx + 1),
                candle_idx_arr: candleIdxArr.slice(0, idx + 1),
                atr: Number(targetRow.atr ?? 0),
                high_of_day: Number(targetRow.high_of_day ?? 0),
                low_of_day: Number(targetRow.low_of_day ?? 0),
                pre_market_high: Number(targetRow.pre_market_high ?? 0),
                change_pct_at_candle: Number(targetRow.change_pct_at_candle ?? 0),
                shares_outstanding: Number(targetRow.shares_outstanding ?? 0),
                market_cap: Number(targetRow.market_cap ?? 0),
                gap_pct: Number(targetRow.gap_pct ?? 0),
                premarket_volume: Number(targetRow.premarket_volume ?? 0),
                _threshold: threshold
            };
            let prob = 0;
            let tradeable = false;
            try {
                const result = await this.callPredictRaw(payload);
                prob = result.prob ?? 0;
                tradeable = result.tradeable ?? false;
            } catch  {
            // prediction failed for this candle — skip
            }
            const { mfr, exitPrice, exitTime } = this.computeMfr(rows, idx);
            const realGood = mfr >= 0.015;
            if (tradeable && realGood) tp++;
            else if (tradeable && !realGood) fp++;
            else if (!tradeable && realGood) fn++;
            else tn++;
            const match = tradeable === realGood;
            const pnl = tradeable ? investment * mfr : 0;
            cumPnL += pnl;
            resultRows.push({
                time,
                open: Number(targetRow.open ?? 0),
                high: Number(targetRow.high ?? 0),
                low: Number(targetRow.low ?? 0),
                close: Number(targetRow.close ?? 0),
                volume: Number(targetRow.volume ?? 0),
                prob,
                tradeable,
                mfr,
                realGood,
                match,
                pnl: Math.round(pnl * 100) / 100,
                cumPnl: Math.round(cumPnL * 100) / 100,
                ...tradeable && {
                    entryPrice: Number(targetRow.close ?? 0)
                },
                ...tradeable && exitPrice != null && {
                    exitPrice
                },
                ...tradeable && exitTime != null && exitTime !== '' && {
                    exitTime
                }
            });
        }
        const total = tp + fp + tn + fn;
        const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
        const accuracy = total > 0 ? (tp + tn) / total : 0;
        return {
            rows: resultRows,
            summary: {
                tp,
                fp,
                tn,
                fn,
                precision: Math.round(precision * 1000) / 10,
                recall: Math.round(recall * 1000) / 10,
                accuracy: Math.round(accuracy * 1000) / 10,
                signals: tp + fp,
                total,
                pnl: Math.round(cumPnL * 100) / 100,
                investment
            }
        };
    }
    // ─── Backtest SSE stream ────────────────────────────────────────────
    backtestStream(ticker, dateStr, fromTime, toTime, threshold, investment, tpPct = 1.5, slPct = 1.5) {
        return new _rxjs.Observable((subscriber)=>{
            this._runBacktestStream(subscriber, ticker, dateStr, fromTime, toTime, threshold, investment, tpPct, slPct);
        });
    }
    async _runBacktestStream(sub, ticker, dateStr, fromTime, toTime, threshold, investment, tpPct, slPct) {
        try {
            const rows = await this.mysqlRepo.getTickerRowsForDate(ticker.toUpperCase(), dateStr, '1m');
            if (!rows.length) {
                sub.next({
                    data: {
                        type: 'error',
                        message: `No data for ${ticker} on ${dateStr}`
                    }
                });
                sub.complete();
                return;
            }
            const toMin = (t)=>{
                const [h, m] = t.split(':').map(Number);
                return h * 60 + m;
            };
            const fromMin = toMin(fromTime);
            const toMinVal = toMin(toTime);
            const allCandles = rows.map((r, i)=>({
                    t: i,
                    o: Number(r.open ?? 0),
                    h: Number(r.high ?? 0),
                    l: Number(r.low ?? 0),
                    c: Number(r.close ?? 0),
                    v: Number(r.volume ?? 0)
                }));
            const candleTimesEt = rows.map((r)=>String(r.candle_time_et ?? '09:30'));
            const candleIdxArr = rows.map((r)=>Number(r.candle_idx ?? 0));
            const targets = [];
            for(let i = 0; i < rows.length; i++){
                const t = String(rows[i].candle_time_et ?? '');
                const m = toMin(t);
                if (m >= fromMin && m <= toMinVal) targets.push({
                    idx: i,
                    time: t
                });
            }
            if (!targets.length) {
                sub.next({
                    data: {
                        type: 'error',
                        message: `No candles in ${fromTime}–${toTime}`
                    }
                });
                sub.complete();
                return;
            }
            // Send total count so frontend can show progress
            sub.next({
                data: {
                    type: 'info',
                    total: targets.length,
                    ticker,
                    date: dateStr
                }
            });
            const tpDec = tpPct / 100;
            const slDec = slPct / 100;
            let tp = 0, fp = 0, tn = 0, fn = 0, cumPnL = 0;
            for(let n = 0; n < targets.length; n++){
                if (sub.closed) return;
                const { idx, time } = targets[n];
                const targetRow = rows[idx];
                const payload = {
                    candles: allCandles.slice(0, idx + 1),
                    target_idx: idx,
                    candle_times_et: candleTimesEt.slice(0, idx + 1),
                    candle_idx_arr: candleIdxArr.slice(0, idx + 1),
                    atr: Number(targetRow.atr ?? 0),
                    high_of_day: Number(targetRow.high_of_day ?? 0),
                    low_of_day: Number(targetRow.low_of_day ?? 0),
                    pre_market_high: Number(targetRow.pre_market_high ?? 0),
                    change_pct_at_candle: Number(targetRow.change_pct_at_candle ?? 0),
                    shares_outstanding: Number(targetRow.shares_outstanding ?? 0),
                    market_cap: Number(targetRow.market_cap ?? 0),
                    gap_pct: Number(targetRow.gap_pct ?? 0),
                    premarket_volume: Number(targetRow.premarket_volume ?? 0),
                    _threshold: threshold
                };
                let prob = 0, tradeable = false;
                try {
                    const result = await this.callPredictRaw(payload);
                    prob = result.prob ?? 0;
                    tradeable = result.tradeable ?? false;
                } catch  {}
                const { mfr, exitPrice: mfrExitPrice, exitTime: mfrExitTime } = this.computeMfr(rows, idx);
                const { tpSlResult, exitPrice: tpSlExitPrice, exitTime: tpSlExitTime } = this.computeTpSlExit(rows, idx, tpDec, slDec);
                const realGood = mfr >= tpDec;
                if (tradeable && realGood) tp++;
                else if (tradeable && !realGood) fp++;
                else if (!tradeable && realGood) fn++;
                else tn++;
                const match = tradeable === realGood;
                let pnl = 0;
                let exitPrice = mfrExitPrice;
                let exitTime = mfrExitTime;
                if (tradeable) {
                    if (tpSlResult === 'win') {
                        pnl = investment * tpDec;
                        exitPrice = tpSlExitPrice;
                        exitTime = tpSlExitTime;
                    } else if (tpSlResult === 'loss') {
                        pnl = -investment * slDec;
                        exitPrice = tpSlExitPrice;
                        exitTime = tpSlExitTime;
                    } else {
                        pnl = investment * mfr;
                    }
                }
                cumPnL += pnl;
                const row = {
                    time,
                    open: Number(targetRow.open ?? 0),
                    high: Number(targetRow.high ?? 0),
                    low: Number(targetRow.low ?? 0),
                    close: Number(targetRow.close ?? 0),
                    volume: Number(targetRow.volume ?? 0),
                    prob,
                    tradeable,
                    mfr,
                    realGood,
                    match,
                    pnl: Math.round(pnl * 100) / 100,
                    cumPnl: Math.round(cumPnL * 100) / 100,
                    ...tradeable && {
                        entryPrice: Number(targetRow.close ?? 0)
                    },
                    ...tradeable && exitPrice != null && {
                        exitPrice
                    },
                    ...tradeable && exitTime != null && exitTime !== '' && {
                        exitTime
                    },
                    ...tradeable && {
                        tpSlResult
                    }
                };
                sub.next({
                    data: {
                        type: 'row',
                        row,
                        progress: n + 1
                    }
                });
            }
            // Final summary
            const total = tp + fp + tn + fn;
            const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
            const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
            const accuracy = total > 0 ? (tp + tn) / total : 0;
            sub.next({
                data: {
                    type: 'summary',
                    summary: {
                        tp,
                        fp,
                        tn,
                        fn,
                        precision: Math.round(precision * 1000) / 10,
                        recall: Math.round(recall * 1000) / 10,
                        accuracy: Math.round(accuracy * 1000) / 10,
                        signals: tp + fp,
                        total,
                        pnl: Math.round(cumPnL * 100) / 100,
                        investment
                    }
                }
            });
            sub.complete();
        } catch (err) {
            sub.next({
                data: {
                    type: 'error',
                    message: err.message
                }
            });
            sub.complete();
        }
    }
    /**
   * Get 1m candles for backtest popup: from entry candle forward.
   * Used when user clicks a tradeable row to see entry → exit chart.
   */ /** Normalize HH:MM or HH:MM:SS to HH:MM for matching */ normalizeTimeEt(s) {
        const t = String(s ?? '').trim();
        if (t.length >= 5) return t.slice(0, 5); // "09:40" or "09:40:00" -> "09:40"
        return t;
    }
    async getBacktestCandles(ticker, dateStr, fromTime, count = 12) {
        const rows = await this.mysqlRepo.getTickerRowsForDate(ticker.toUpperCase(), dateStr, '1m');
        if (!rows.length) {
            this.logger.warn(`getBacktestCandles: no rows for ${ticker} ${dateStr}`);
            return {
                candles: []
            };
        }
        const fromNorm = this.normalizeTimeEt(fromTime);
        let startIdx = -1;
        for(let i = 0; i < rows.length; i++){
            if (this.normalizeTimeEt(String(rows[i].candle_time_et ?? '')) === fromNorm) {
                startIdx = i;
                break;
            }
        }
        if (startIdx < 0) {
            const sample = rows.slice(0, 5).map((r)=>String(r.candle_time_et ?? ''));
            this.logger.warn(`getBacktestCandles: fromTime=${fromTime} (norm=${fromNorm}) not found. Sample: ${sample.join(', ')}`);
            return {
                candles: []
            };
        }
        const slice = rows.slice(startIdx, startIdx + count);
        const candles = this.rowsToCandleData(slice, dateStr);
        candles.sort((a, b)=>a.t - b.t);
        return {
            candles
        };
    }
    rowsToCandleData(rows, dateStr) {
        const pad = (n)=>String(Math.max(0, Math.floor(n))).padStart(2, '0');
        const candles = [];
        for (const r of rows){
            const timeEt = this.normalizeTimeEt(String(r.candle_time_et ?? '00:00')) || '00:00';
            const parts = timeEt.split(':');
            const h = parseInt(parts[0] ?? '0', 10) || 0;
            const m = parseInt(parts[1] ?? '0', 10) || 0;
            const [, mo, d] = String(dateStr).split('-').map(Number);
            const isEDT = mo > 3 && mo < 11 || mo === 3 && d >= 8 || mo === 11 && d < 7;
            const offset = isEDT ? '-04:00' : '-05:00';
            const ts = new Date(`${dateStr}T${pad(h)}:${pad(m)}:00${offset}`).getTime();
            candles.push({
                t: ts,
                o: Number(r.open ?? 0),
                h: Number(r.high ?? 0),
                l: Number(r.low ?? 0),
                c: Number(r.close ?? 0),
                v: Number(r.volume ?? 0)
            });
        }
        return candles;
    }
    callPredictRaw(payload) {
        const input = JSON.stringify(payload);
        return new Promise((resolve, reject)=>{
            const proc = (0, _child_process.spawn)('python3', [
                this.scriptPath
            ], {
                cwd: _path.dirname(this.scriptPath),
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ]
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk)=>{
                stdout += chunk.toString();
            });
            proc.stderr.on('data', (chunk)=>{
                stderr += chunk.toString();
            });
            proc.on('error', (err)=>reject(err));
            proc.on('close', (code)=>{
                try {
                    resolve(JSON.parse(stdout));
                } catch  {
                    reject(new Error(stderr || `exit ${code}`));
                }
            });
            proc.stdin.write(input, ()=>proc.stdin.end());
        });
    }
    constructor(mysqlRepo){
        this.mysqlRepo = mysqlRepo;
        this.logger = new _common.Logger(PredictorService.name);
        const stockTraining = _path.resolve(process.cwd(), process.env.STOCK_TRAINING_PATH ?? _path.join('..', 'stock-training'));
        this.scriptPath = _path.join(stockTraining, 'ml', 'experiments', 'predict.py');
        this.evaluateScriptPath = _path.join(stockTraining, 'ml', 'random_forest', 'evaluate.py');
    }
};
PredictorService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _mysqltrainingrepository.MysqlTrainingRepository === "undefined" ? Object : _mysqltrainingrepository.MysqlTrainingRepository
    ])
], PredictorService);

//# sourceMappingURL=predictor.service.js.map