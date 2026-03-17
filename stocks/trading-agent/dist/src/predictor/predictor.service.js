"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var PredictorService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PredictorService = void 0;
const common_1 = require("@nestjs/common");
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const rxjs_1 = require("rxjs");
const mysql_training_repository_1 = require("../scanner/mysql/mysql-training.repository");
let PredictorService = PredictorService_1 = class PredictorService {
    constructor(mysqlRepo) {
        this.mysqlRepo = mysqlRepo;
        this.logger = new common_1.Logger(PredictorService_1.name);
        const stockTraining = path.resolve(process.cwd(), process.env.STOCK_TRAINING_PATH ?? path.join('..', 'stock-training'));
        this.scriptPath = path.join(stockTraining, 'ml', 'experiments', 'predict.py');
        this.batchScriptPath = path.join(stockTraining, 'ml', 'experiments', 'predict_batch.py');
        this.evaluateScriptPath = path.join(stockTraining, 'ml', 'random_forest', 'evaluate.py');
    }
    async evaluate(threshold = 0.5) {
        return new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)('python3', [this.evaluateScriptPath, '--json', '--threshold', String(threshold)], {
                cwd: path.dirname(this.evaluateScriptPath),
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            proc.on('error', (err) => {
                this.logger.error(`Evaluate spawn error: ${err.message}`);
                reject(err);
            });
            proc.on('close', (code) => {
                if (code !== 0) {
                    this.logger.warn(`Evaluate script exit ${code}: ${stderr}`);
                    reject(new Error(stderr || `Evaluate failed with code ${code}`));
                    return;
                }
                try {
                    resolve(JSON.parse(stdout));
                }
                catch {
                    reject(new Error(`Invalid evaluate output: ${stdout}`));
                }
            });
        });
    }
    async predict(features, threshold = 0.3) {
        let payload;
        if (features.ticker && features.date && features.candle_time_et) {
            const rows = await this.mysqlRepo.getTickerRowsForDate(features.ticker, features.date, '1m');
            if (!rows.length) {
                return { tradeable: false, prob: 0, threshold, error: `No data for ${features.ticker} on ${features.date}` };
            }
            let targetIdx = rows.length - 1;
            for (let i = 0; i < rows.length; i++) {
                if (String(rows[i].candle_time_et) === features.candle_time_et) {
                    targetIdx = i;
                }
            }
            const candles = rows.map((r, i) => ({
                t: i,
                o: Number(r.open ?? 0),
                h: Number(r.high ?? 0),
                l: Number(r.low ?? 0),
                c: Number(r.close ?? 0),
                v: Number(r.volume ?? 0),
            }));
            const candleTimesEt = rows.map((r) => String(r.candle_time_et ?? '09:30'));
            const candleIdxArr = rows.map((r) => Number(r.candle_idx ?? 0));
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
                shares_outstanding: Number(targetRow.shares_outstanding ?? 0),
                market_cap: Number(targetRow.market_cap ?? 0),
                gap_pct: Number(targetRow.gap_pct ?? 0),
                premarket_volume: Number(targetRow.premarket_volume ?? 0),
                _threshold: threshold,
            };
            this.logger.log(`Historical predict: ${features.ticker} ${features.date} ${features.candle_time_et} (${rows.length} candles, target=${targetIdx})`);
        }
        else {
            payload = { ...features, _threshold: threshold };
        }
        const input = JSON.stringify(payload);
        return new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)('python3', [this.scriptPath], {
                cwd: path.dirname(this.scriptPath),
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            proc.on('error', (err) => {
                this.logger.error(`Predict spawn error: ${err.message}`);
                reject(err);
            });
            proc.on('close', (code) => {
                if (code !== 0) {
                    this.logger.warn(`Predict script exit ${code}: ${stderr}`);
                }
                try {
                    const result = JSON.parse(stdout);
                    if (result.error) {
                        reject(new Error(result.error));
                    }
                    else {
                        resolve(result);
                    }
                }
                catch {
                    reject(new Error(`Invalid predict output: ${stdout}`));
                }
            });
            proc.stdin.write(input, () => proc.stdin.end());
        });
    }
    computeTpSlExit(rows, idx, tpPct, slPct, lookAhead = 10) {
        const refClose = Number(rows[idx]?.close ?? 0);
        if (refClose <= 0)
            return { tpSlResult: 'neutral' };
        const levelUp = refClose * (1 + tpPct);
        const levelDown = refClose * (1 - slPct);
        let prevClose = refClose;
        const n = Math.min(lookAhead, rows.length - idx - 1);
        for (let j = 1; j <= n; j++) {
            const r = rows[idx + j];
            if (!r)
                break;
            const openJ = Number(r.open ?? 0);
            const highJ = Number(r.high ?? 0);
            const lowJ = Number(r.low ?? 0);
            const closeJ = Number(r.close ?? 0);
            if (prevClose < openJ && prevClose < levelUp && levelUp < openJ) {
                return { tpSlResult: 'win', exitPrice: levelUp, exitTime: String(r.candle_time_et ?? '') };
            }
            if (prevClose > openJ && openJ < levelDown && levelDown < prevClose) {
                return { tpSlResult: 'loss', exitPrice: levelDown, exitTime: String(r.candle_time_et ?? '') };
            }
            const touchUp = highJ >= levelUp;
            const touchDown = lowJ <= levelDown;
            if (touchUp && touchDown) {
                const hit = closeJ >= openJ ? 'loss' : 'win';
                const price = closeJ >= openJ ? levelDown : levelUp;
                return { tpSlResult: hit, exitPrice: price, exitTime: String(r.candle_time_et ?? '') };
            }
            if (touchUp)
                return { tpSlResult: 'win', exitPrice: levelUp, exitTime: String(r.candle_time_et ?? '') };
            if (touchDown)
                return { tpSlResult: 'loss', exitPrice: levelDown, exitTime: String(r.candle_time_et ?? '') };
            prevClose = closeJ;
        }
        return { tpSlResult: 'neutral' };
    }
    computeMfr(rows, idx, lookAhead = 10) {
        const closeT = Number(rows[idx].close ?? 0);
        const canScan = closeT > 0 && idx + lookAhead < rows.length;
        if (canScan) {
            let maxHigh = 0;
            let exitIdx = -1;
            for (let j = idx + 1; j <= idx + lookAhead; j++) {
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
                exitTime: exitIdx >= 0 ? String(rows[exitIdx]?.candle_time_et ?? '') : undefined,
            };
        }
        if (lookAhead === 10) {
            const dbVal = rows[idx].max_future_return_10m;
            if (dbVal != null)
                return { mfr: Number(dbVal) };
        }
        return { mfr: 0 };
    }
    async backtest(ticker, dateStr, fromTime, toTime, threshold, investment) {
        const rows = await this.mysqlRepo.getTickerRowsForDate(ticker.toUpperCase(), dateStr, '1m');
        if (!rows.length) {
            return { rows: [], summary: null, error: `No data for ${ticker} on ${dateStr}` };
        }
        const toMin = (t) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };
        const fromMin = toMin(fromTime);
        const toMinVal = toMin(toTime);
        const allCandles = rows.map((r, i) => ({
            t: i,
            o: Number(r.open ?? 0),
            h: Number(r.high ?? 0),
            l: Number(r.low ?? 0),
            c: Number(r.close ?? 0),
            v: Number(r.volume ?? 0),
        }));
        const candleTimesEt = rows.map((r) => String(r.candle_time_et ?? '09:30'));
        const candleIdxArr = rows.map((r) => Number(r.candle_idx ?? 0));
        const targets = [];
        for (let i = 0; i < rows.length; i++) {
            const t = String(rows[i].candle_time_et ?? '');
            const m = toMin(t);
            if (m >= fromMin && m <= toMinVal) {
                targets.push({ idx: i, time: t });
            }
        }
        if (!targets.length) {
            return { rows: [], summary: null, error: `No candles in ${fromTime}–${toTime}` };
        }
        let tp = 0, fp = 0, tn = 0, fn = 0;
        let cumPnL = 0;
        const resultRows = [];
        for (const { idx, time } of targets) {
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
                _threshold: threshold,
            };
            let prob = 0;
            let tradeable = false;
            try {
                const result = await this.callPredictRaw(payload);
                prob = result.prob ?? 0;
                tradeable = result.tradeable ?? false;
            }
            catch {
            }
            const { mfr, exitPrice, exitTime } = this.computeMfr(rows, idx);
            const realGood = mfr >= 0.015;
            if (tradeable && realGood)
                tp++;
            else if (tradeable && !realGood)
                fp++;
            else if (!tradeable && realGood)
                fn++;
            else
                tn++;
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
                ...(tradeable && { entryPrice: Number(targetRow.close ?? 0) }),
                ...(tradeable && exitPrice != null && { exitPrice }),
                ...(tradeable && exitTime != null && exitTime !== '' && { exitTime }),
            });
        }
        const total = tp + fp + tn + fn;
        const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
        const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
        const accuracy = total > 0 ? (tp + tn) / total : 0;
        return {
            rows: resultRows,
            summary: {
                tp, fp, tn, fn,
                precision: Math.round(precision * 1000) / 10,
                recall: Math.round(recall * 1000) / 10,
                accuracy: Math.round(accuracy * 1000) / 10,
                signals: tp + fp,
                total,
                pnl: Math.round(cumPnL * 100) / 100,
                investment,
            },
        };
    }
    async _runSingleSymbolBacktest(ticker, dateStr, fromTime, toTime, threshold, investment, tpPct, slPct, lookAhead) {
        const rows = await this.mysqlRepo.getTickerRowsForDate(ticker.toUpperCase(), dateStr, '1m');
        if (!rows.length)
            return null;
        const toMin = (t) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };
        const fromMin = toMin(fromTime);
        const toMinVal = toMin(toTime);
        const allCandles = rows.map((r, i) => ({
            t: i,
            o: Number(r.open ?? 0),
            h: Number(r.high ?? 0),
            l: Number(r.low ?? 0),
            c: Number(r.close ?? 0),
            v: Number(r.volume ?? 0),
        }));
        const candleTimesEt = rows.map((r) => String(r.candle_time_et ?? '09:30'));
        const candleIdxArr = rows.map((r) => Number(r.candle_idx ?? 0));
        const targets = [];
        for (let i = 0; i < rows.length; i++) {
            const t = String(rows[i].candle_time_et ?? '');
            const m = toMin(t);
            if (m >= fromMin && m <= toMinVal)
                targets.push({ idx: i, time: t });
        }
        if (!targets.length)
            return null;
        const tpDec = tpPct / 100;
        const slDec = slPct / 100;
        const payloads = targets.map(({ idx }) => {
            const targetRow = rows[idx];
            return {
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
                _threshold: threshold,
            };
        });
        let results = [];
        try {
            results = await this.callPredictBatch(payloads, threshold);
        }
        catch {
            return null;
        }
        let tp = 0, fp = 0, tn = 0, fn = 0, cumPnL = 0;
        let wins = 0, losses = 0, neutrals = 0;
        for (let n = 0; n < targets.length; n++) {
            const { idx } = targets[n];
            const targetRow = rows[idx];
            const r = results[n] ?? { tradeable: false, prob: 0, threshold };
            const tradeable = r.tradeable ?? false;
            const { mfr } = this.computeMfr(rows, idx, lookAhead);
            const { tpSlResult } = this.computeTpSlExit(rows, idx, tpDec, slDec, lookAhead);
            const realGood = mfr >= tpDec;
            if (tradeable && realGood)
                tp++;
            else if (tradeable && !realGood)
                fp++;
            else if (!tradeable && realGood)
                fn++;
            else
                tn++;
            if (tradeable && tpSlResult) {
                if (tpSlResult === 'win')
                    wins++;
                else if (tpSlResult === 'loss')
                    losses++;
                else
                    neutrals++;
            }
            let pnl = 0;
            if (tradeable) {
                if (tpSlResult === 'win')
                    pnl = investment * tpDec;
                else if (tpSlResult === 'loss')
                    pnl = -investment * slDec;
                else
                    pnl = investment * mfr;
            }
            cumPnL += pnl;
        }
        return { tp, fp, tn, fn, pnl: cumPnL, wins, losses, neutrals };
    }
    backtestStream(ticker, dateStr, fromTime, toTime, threshold, investment, tpPct = 1.5, slPct = 1.5, lookAhead = 10) {
        return new rxjs_1.Observable((subscriber) => {
            this._runBacktestStream(subscriber, ticker, dateStr, fromTime, toTime, threshold, investment, tpPct, slPct, lookAhead);
        });
    }
    backtestStreamDay(dateStr, fromTime, toTime, threshold, investment, tpPct = 1.5, slPct = 1.5, lookAhead = 10, symbolsOverride) {
        return new rxjs_1.Observable((subscriber) => {
            this._runBacktestStreamDay(subscriber, dateStr, fromTime, toTime, threshold, investment, tpPct, slPct, lookAhead, symbolsOverride);
        });
    }
    async _runBacktestStreamDay(sub, dateStr, fromTime, toTime, threshold, investment, tpPct, slPct, lookAhead, symbolsOverride) {
        try {
            let symbols;
            if (symbolsOverride && symbolsOverride.length > 0) {
                symbols = symbolsOverride;
            }
            else {
                const movers = await this.mysqlRepo.getTopMovers(dateStr);
                symbols = movers.map((m) => m.symbol).filter(Boolean);
            }
            if (!symbols.length) {
                sub.next({ data: { type: 'error', message: `No symbols for ${dateStr}` } });
                sub.complete();
                return;
            }
            sub.next({
                data: { type: 'info', totalSymbols: symbols.length, symbols },
            });
            let totTp = 0, totFp = 0, totTn = 0, totFn = 0, totPnl = 0;
            let totWins = 0, totLosses = 0, totNeutrals = 0;
            let symbolsWithData = 0;
            for (let i = 0; i < symbols.length; i++) {
                if (sub.closed)
                    return;
                const symbol = symbols[i];
                const result = await this._runSingleSymbolBacktest(symbol, dateStr, fromTime, toTime, threshold, investment, tpPct, slPct, lookAhead);
                if (result) {
                    totTp += result.tp;
                    totFp += result.fp;
                    totTn += result.tn;
                    totFn += result.fn;
                    totPnl += result.pnl;
                    totWins += result.wins;
                    totLosses += result.losses;
                    totNeutrals += result.neutrals;
                    const hasSignals = result.wins + result.losses + result.neutrals > 0;
                    if (hasSignals)
                        symbolsWithData++;
                }
                sub.next({
                    data: {
                        type: 'symbol_done',
                        symbol,
                        progress: i + 1,
                        totalSymbols: symbols.length,
                        ...(result && { wins: result.wins, losses: result.losses, neutrals: result.neutrals }),
                    },
                });
            }
            const total = totTp + totFp + totTn + totFn;
            const precision = totTp + totFp > 0 ? totTp / (totTp + totFp) : 0;
            const recall = totTp + totFn > 0 ? totTp / (totTp + totFn) : 0;
            const accuracy = total > 0 ? (totTp + totTn) / total : 0;
            sub.next({
                data: {
                    type: 'summary',
                    summary: {
                        tp: totTp,
                        fp: totFp,
                        tn: totTn,
                        fn: totFn,
                        precision: Math.round(precision * 1000) / 10,
                        recall: Math.round(recall * 1000) / 10,
                        accuracy: Math.round(accuracy * 1000) / 10,
                        signals: totTp + totFp,
                        total,
                        pnl: Math.round(totPnl * 100) / 100,
                        investment,
                        wins: totWins,
                        losses: totLosses,
                        neutrals: totNeutrals,
                        symbolsWithData,
                        symbolsTotal: symbols.length,
                    },
                },
            });
            sub.complete();
        }
        catch (err) {
            sub.next({ data: { type: 'error', message: err.message } });
            sub.complete();
        }
    }
    async _runBacktestStream(sub, ticker, dateStr, fromTime, toTime, threshold, investment, tpPct, slPct, lookAhead) {
        try {
            const rows = await this.mysqlRepo.getTickerRowsForDate(ticker.toUpperCase(), dateStr, '1m');
            if (!rows.length) {
                sub.next({ data: { type: 'error', message: `No data for ${ticker} on ${dateStr}` } });
                sub.complete();
                return;
            }
            const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
            const fromMin = toMin(fromTime);
            const toMinVal = toMin(toTime);
            const allCandles = rows.map((r, i) => ({
                t: i, o: Number(r.open ?? 0), h: Number(r.high ?? 0),
                l: Number(r.low ?? 0), c: Number(r.close ?? 0), v: Number(r.volume ?? 0),
            }));
            const candleTimesEt = rows.map((r) => String(r.candle_time_et ?? '09:30'));
            const candleIdxArr = rows.map((r) => Number(r.candle_idx ?? 0));
            const targets = [];
            for (let i = 0; i < rows.length; i++) {
                const t = String(rows[i].candle_time_et ?? '');
                const m = toMin(t);
                if (m >= fromMin && m <= toMinVal)
                    targets.push({ idx: i, time: t });
            }
            if (!targets.length) {
                sub.next({ data: { type: 'error', message: `No candles in ${fromTime}–${toTime}` } });
                sub.complete();
                return;
            }
            sub.next({ data: { type: 'info', total: targets.length, ticker, date: dateStr } });
            const tpDec = tpPct / 100;
            const slDec = slPct / 100;
            const payloads = targets.map(({ idx }) => {
                const targetRow = rows[idx];
                return {
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
                    _threshold: threshold,
                };
            });
            let results = [];
            try {
                results = await this.callPredictBatch(payloads, threshold);
            }
            catch (err) {
                sub.next({ data: { type: 'error', message: String(err?.message ?? err) } });
                sub.complete();
                return;
            }
            let tp = 0, fp = 0, tn = 0, fn = 0, cumPnL = 0;
            for (let n = 0; n < targets.length; n++) {
                if (sub.closed)
                    return;
                const { idx, time } = targets[n];
                const targetRow = rows[idx];
                const r = results[n] ?? { tradeable: false, prob: 0, threshold };
                const prob = r.prob ?? 0;
                const tradeable = r.tradeable ?? false;
                const { mfr, exitPrice: mfrExitPrice, exitTime: mfrExitTime } = this.computeMfr(rows, idx, lookAhead);
                const { tpSlResult, exitPrice: tpSlExitPrice, exitTime: tpSlExitTime } = this.computeTpSlExit(rows, idx, tpDec, slDec, lookAhead);
                const realGood = mfr >= tpDec;
                if (tradeable && realGood)
                    tp++;
                else if (tradeable && !realGood)
                    fp++;
                else if (!tradeable && realGood)
                    fn++;
                else
                    tn++;
                const match = tradeable === realGood;
                let pnl = 0;
                let exitPrice = mfrExitPrice;
                let exitTime = mfrExitTime;
                if (tradeable) {
                    if (tpSlResult === 'win') {
                        pnl = investment * tpDec;
                        exitPrice = tpSlExitPrice;
                        exitTime = tpSlExitTime;
                    }
                    else if (tpSlResult === 'loss') {
                        pnl = -investment * slDec;
                        exitPrice = tpSlExitPrice;
                        exitTime = tpSlExitTime;
                    }
                    else {
                        pnl = investment * mfr;
                    }
                }
                cumPnL += pnl;
                const row = {
                    time, open: Number(targetRow.open ?? 0), high: Number(targetRow.high ?? 0),
                    low: Number(targetRow.low ?? 0), close: Number(targetRow.close ?? 0),
                    volume: Number(targetRow.volume ?? 0),
                    prob, tradeable, mfr, realGood, match,
                    pnl: Math.round(pnl * 100) / 100,
                    cumPnl: Math.round(cumPnL * 100) / 100,
                    ...(tradeable && { entryPrice: Number(targetRow.close ?? 0) }),
                    ...(tradeable && exitPrice != null && { exitPrice }),
                    ...(tradeable && exitTime != null && exitTime !== '' && { exitTime }),
                    ...(tradeable && { tpSlResult }),
                };
                sub.next({ data: { type: 'row', row, progress: n + 1 } });
            }
            const total = tp + fp + tn + fn;
            const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
            const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
            const accuracy = total > 0 ? (tp + tn) / total : 0;
            sub.next({ data: {
                    type: 'summary',
                    summary: {
                        tp, fp, tn, fn,
                        precision: Math.round(precision * 1000) / 10,
                        recall: Math.round(recall * 1000) / 10,
                        accuracy: Math.round(accuracy * 1000) / 10,
                        signals: tp + fp, total,
                        pnl: Math.round(cumPnL * 100) / 100,
                        investment,
                    },
                } });
            sub.complete();
        }
        catch (err) {
            sub.next({ data: { type: 'error', message: err.message } });
            sub.complete();
        }
    }
    normalizeTimeEt(s) {
        const t = String(s ?? '').trim();
        if (t.length >= 5)
            return t.slice(0, 5);
        return t;
    }
    async getBacktestCandles(ticker, dateStr, fromTime, count = 12) {
        const rows = await this.mysqlRepo.getTickerRowsForDate(ticker.toUpperCase(), dateStr, '1m');
        if (!rows.length) {
            this.logger.warn(`getBacktestCandles: no rows for ${ticker} ${dateStr}`);
            return { candles: [] };
        }
        const fromNorm = this.normalizeTimeEt(fromTime);
        let startIdx = -1;
        for (let i = 0; i < rows.length; i++) {
            if (this.normalizeTimeEt(String(rows[i].candle_time_et ?? '')) === fromNorm) {
                startIdx = i;
                break;
            }
        }
        if (startIdx < 0) {
            const sample = rows.slice(0, 5).map((r) => String(r.candle_time_et ?? ''));
            this.logger.warn(`getBacktestCandles: fromTime=${fromTime} (norm=${fromNorm}) not found. Sample: ${sample.join(', ')}`);
            return { candles: [] };
        }
        const slice = rows.slice(startIdx, startIdx + count);
        const candles = this.rowsToCandleData(slice, dateStr);
        candles.sort((a, b) => a.t - b.t);
        return { candles };
    }
    rowsToCandleData(rows, dateStr) {
        const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
        const candles = [];
        for (const r of rows) {
            const timeEt = this.normalizeTimeEt(String(r.candle_time_et ?? '00:00')) || '00:00';
            const parts = timeEt.split(':');
            const h = parseInt(parts[0] ?? '0', 10) || 0;
            const m = parseInt(parts[1] ?? '0', 10) || 0;
            const [, mo, d] = String(dateStr).split('-').map(Number);
            const isEDT = (mo > 3 && mo < 11) || (mo === 3 && d >= 8) || (mo === 11 && d < 7);
            const offset = isEDT ? '-04:00' : '-05:00';
            const ts = new Date(`${dateStr}T${pad(h)}:${pad(m)}:00${offset}`).getTime();
            candles.push({
                t: ts,
                o: Number(r.open ?? 0),
                h: Number(r.high ?? 0),
                l: Number(r.low ?? 0),
                c: Number(r.close ?? 0),
                v: Number(r.volume ?? 0),
            });
        }
        return candles;
    }
    callPredictRaw(payload) {
        const input = JSON.stringify(payload);
        return new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)('python3', [this.scriptPath], {
                cwd: path.dirname(this.scriptPath),
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            proc.on('error', (err) => reject(err));
            proc.on('close', (code) => {
                try {
                    resolve(JSON.parse(stdout));
                }
                catch {
                    reject(new Error(stderr || `exit ${code}`));
                }
            });
            proc.stdin.write(input, () => proc.stdin.end());
        });
    }
    async callPredictBatch(payloads, threshold) {
        if (!payloads.length)
            return [];
        const batch = payloads.map((p) => {
            const { _threshold: _, ...rest } = p;
            return rest;
        });
        const input = JSON.stringify({ batch, _threshold: threshold });
        return new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)('python3', [this.batchScriptPath], {
                cwd: path.dirname(this.batchScriptPath),
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            proc.on('error', (err) => reject(err));
            proc.on('close', (code) => {
                try {
                    const out = JSON.parse(stdout);
                    if (out.error)
                        reject(new Error(out.error));
                    else
                        resolve(out.results ?? []);
                }
                catch {
                    reject(new Error(stderr || `exit ${code}, stdout=${stdout}`));
                }
            });
            proc.stdin.write(input, () => proc.stdin.end());
        });
    }
};
exports.PredictorService = PredictorService;
exports.PredictorService = PredictorService = PredictorService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [mysql_training_repository_1.MysqlTrainingRepository])
], PredictorService);
//# sourceMappingURL=predictor.service.js.map