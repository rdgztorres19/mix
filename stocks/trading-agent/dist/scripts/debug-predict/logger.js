"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "DebugPredictLogger", {
    enumerable: true,
    get: function() {
        return DebugPredictLogger;
    }
});
const _chalk = /*#__PURE__*/ _interop_require_default(require("chalk"));
const _clitable3 = /*#__PURE__*/ _interop_require_default(require("cli-table3"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const INVESTMENT = 200;
function colorProb(prob, threshold) {
    const pct = (prob * 100).toFixed(1) + '%';
    if (prob >= threshold) return _chalk.default.green.bold(pct);
    if (prob >= threshold * 0.9) return _chalk.default.yellow(pct);
    return _chalk.default.dim(pct);
}
function colorPnl(val) {
    const str = (val >= 0 ? '+' : '') + '$' + val.toFixed(2);
    if (val > 0) return _chalk.default.green.bold(str);
    if (val < 0) return _chalk.default.red.bold(str);
    return _chalk.default.gray(str);
}
function colorResult(result) {
    if (result === 'win') return _chalk.default.green.bold('win');
    if (result === 'loss') return _chalk.default.red.bold('loss');
    return _chalk.default.gray('--');
}
// ── Candlestick chart rendering ──────────────────────────────────────────────
const WICK = '│';
const BODY_UP = '┃'; // green candle (close > open)
const BODY_DOWN = '┃'; // red candle (close < open)
const DOJI = '─';
function renderCandlestickChart(signals, chartHeight = 24, chartWidth) {
    if (!signals.length) return [];
    const termWidth = chartWidth ?? Math.min(process.stdout.columns || 120, 160);
    // Each candle takes 2 chars (candle + space), reserve left margin for price labels
    const marginLeft = 10;
    const marginBottom = 2;
    const availWidth = termWidth - marginLeft - 2;
    const step = Math.max(1, Math.ceil(signals.length / availWidth));
    const sampled = [];
    for(let i = 0; i < signals.length; i += step){
        sampled.push(signals[i]);
    }
    const allHighs = sampled.map((s)=>s.high);
    const allLows = sampled.map((s)=>s.low);
    const maxPrice = Math.max(...allHighs);
    const minPrice = Math.min(...allLows);
    const range = maxPrice - minPrice || 0.01;
    const toRow = (price)=>{
        return Math.round((price - minPrice) / range * (chartHeight - 1));
    };
    // Build grid
    const grid = [];
    for(let r = 0; r < chartHeight; r++){
        grid.push(new Array(sampled.length).fill(' '));
    }
    // Draw candles
    for(let col = 0; col < sampled.length; col++){
        const s = sampled[col];
        const highRow = toRow(s.high);
        const lowRow = toRow(s.low);
        const openRow = toRow(s.open);
        const closeRow = toRow(s.close);
        const bodyTop = Math.max(openRow, closeRow);
        const bodyBot = Math.min(openRow, closeRow);
        const isUp = s.close >= s.open;
        for(let r = lowRow; r <= highRow; r++){
            if (r >= bodyBot && r <= bodyTop) {
                if (bodyTop === bodyBot) {
                    grid[r][col] = DOJI;
                } else {
                    grid[r][col] = isUp ? BODY_UP : BODY_DOWN;
                }
            } else {
                grid[r][col] = WICK;
            }
        }
    }
    // Render lines (top to bottom = high to low)
    const lines = [];
    const priceSteps = 5;
    for(let r = chartHeight - 1; r >= 0; r--){
        let label = '';
        if (r === chartHeight - 1 || r === 0 || chartHeight > priceSteps && r % Math.floor(chartHeight / priceSteps) === 0) {
            const price = minPrice + r / (chartHeight - 1) * range;
            label = price.toFixed(3);
        }
        const margin = label.padStart(marginLeft - 1) + ' ';
        let row = '';
        for(let col = 0; col < sampled.length; col++){
            const cell = grid[r][col];
            const s = sampled[col];
            const isUp = s.close >= s.open;
            if (cell === BODY_UP || cell === BODY_DOWN) {
                row += isUp ? _chalk.default.green(cell) : _chalk.default.red(cell);
            } else if (cell === DOJI) {
                row += _chalk.default.yellow(cell);
            } else if (cell === WICK) {
                row += _chalk.default.dim(cell);
            } else {
                row += ' ';
            }
            row += ' '; // spacing between candles
        }
        lines.push(_chalk.default.dim(margin) + row);
    }
    // Bottom axis: time labels
    let timeAxis = ' '.repeat(marginLeft);
    const labelEvery = Math.max(1, Math.floor(sampled.length / 8));
    for(let col = 0; col < sampled.length; col++){
        if (col % labelEvery === 0) {
            const t = sampled[col].time;
            timeAxis += t;
            // pad remaining space
            const remaining = 2 - t.length;
            if (remaining > 0) timeAxis += ' '.repeat(remaining);
        } else {
            timeAxis += '  ';
        }
    }
    lines.push(_chalk.default.dim(timeAxis));
    // BUY markers row
    let buyRow = ' '.repeat(marginLeft);
    for(let col = 0; col < sampled.length; col++){
        const s = sampled[col];
        if (s.tradeable) {
            const result = s.trade?.result;
            if (result === 'win') buyRow += _chalk.default.green.bold('^');
            else if (result === 'loss') buyRow += _chalk.default.red.bold('^');
            else buyRow += _chalk.default.yellow('^');
        } else {
            buyRow += ' ';
        }
        buyRow += ' ';
    }
    lines.push(buyRow);
    return lines;
}
let DebugPredictLogger = class DebugPredictLogger {
    printHeader(symbol, date, fromTime, toTime) {
        console.log(_chalk.default.bgBlue.white.bold('\n  Debug Predict  '));
        console.log(_chalk.default.dim('  Symbol: ') + _chalk.default.white.bold(symbol) + _chalk.default.dim(' | Date: ') + _chalk.default.white.bold(date) + _chalk.default.dim(' | Time: ') + _chalk.default.white.bold(`${fromTime}-${toTime}`));
        console.log(_chalk.default.dim('  Thr: ') + _chalk.default.yellow.bold(String(this.threshold)) + _chalk.default.dim(' | TP: ') + _chalk.default.green.bold(`${this.tpPct}%`) + _chalk.default.dim(' | SL: ') + _chalk.default.red.bold(`${this.slPct}%`) + _chalk.default.dim(' | Inv: ') + _chalk.default.white.bold(`$${INVESTMENT}`) + '\n');
    }
    printTable(signals) {
        const tpDec = this.tpPct / 100;
        const slDec = this.slPct / 100;
        const table = new _clitable3.default({
            head: [
                'Time',
                'Open',
                'High',
                'Low',
                'Close',
                'Vol',
                'Prob',
                'Trade',
                'MFR10m',
                `Real>=${this.tpPct}%`,
                'TP/SL',
                'Match',
                'P/L',
                'Cumul'
            ].map((h)=>_chalk.default.cyan(h)),
            chars: {
                top: '-',
                'top-mid': '+',
                'top-left': '+',
                'top-right': '+',
                bottom: '-',
                'bottom-mid': '+',
                'bottom-left': '+',
                'bottom-right': '+',
                left: '|',
                'left-mid': '+',
                mid: '-',
                'mid-mid': '+',
                right: '|',
                'right-mid': '+',
                middle: '|'
            },
            style: {
                head: [],
                border: [
                    'dim'
                ]
            }
        });
        let cumPnl = 0;
        const cm = {
            tp: 0,
            fp: 0,
            tn: 0,
            fn: 0
        };
        let totalTrades = 0;
        let wins = 0;
        let losses = 0;
        let neutrals = 0;
        for (const s of signals){
            const realGood = s.mfr10m >= tpDec;
            const tpSlResult = s.trade?.result ?? 'neutral';
            // Confusion matrix
            if (s.tradeable && realGood) cm.tp++;
            else if (s.tradeable && !realGood) cm.fp++;
            else if (!s.tradeable && realGood) cm.fn++;
            else cm.tn++;
            // P/L
            let pnl = 0;
            if (s.tradeable) {
                totalTrades++;
                if (tpSlResult === 'win') {
                    wins++;
                    pnl = INVESTMENT * tpDec;
                } else if (tpSlResult === 'loss') {
                    losses++;
                    pnl = -INVESTMENT * slDec;
                } else {
                    neutrals++;
                    pnl = INVESTMENT * s.mfr10m;
                }
            }
            cumPnl += pnl;
            const match = s.tradeable === realGood;
            table.push([
                _chalk.default.white(s.time),
                s.open.toFixed(3),
                s.high.toFixed(3),
                s.low.toFixed(3),
                s.close.toFixed(3),
                String(s.volume),
                colorProb(s.prob, this.threshold),
                s.tradeable ? _chalk.default.green.bold('BUY') : _chalk.default.dim('SKIP'),
                (s.mfr10m * 100).toFixed(2) + '%',
                realGood ? _chalk.default.green('Y') : _chalk.default.red('N'),
                s.tradeable ? colorResult(tpSlResult) : _chalk.default.dim(''),
                match ? _chalk.default.green('Y') : _chalk.default.red('N'),
                s.tradeable ? colorPnl(pnl) : _chalk.default.dim(''),
                colorPnl(cumPnl)
            ]);
        }
        console.log(table.toString());
        // Candlestick chart
        console.log(_chalk.default.cyan.bold('\n  Candlestick Chart'));
        console.log(_chalk.default.dim('  ') + _chalk.default.green('^') + _chalk.default.dim('=BUY win  ') + _chalk.default.red('^') + _chalk.default.dim('=BUY loss  ') + _chalk.default.yellow('^') + _chalk.default.dim('=BUY neutral'));
        const chartLines = renderCandlestickChart(signals);
        for (const line of chartLines)console.log(line);
        this.printSummary(cm, totalTrades, wins, losses, neutrals, cumPnl);
    }
    printSummary(cm, totalTrades, wins, losses, neutrals, cumPnl) {
        const divider = _chalk.default.blue('='.repeat(74));
        console.log(`\n${divider}`);
        console.log(_chalk.default.bgBlue.white.bold('  SUMMARY  '));
        const total = cm.tp + cm.fp + cm.tn + cm.fn;
        const precision = cm.tp + cm.fp > 0 ? cm.tp / (cm.tp + cm.fp) : 0;
        const recall = cm.tp + cm.fn > 0 ? cm.tp / (cm.tp + cm.fn) : 0;
        const accuracy = total > 0 ? (cm.tp + cm.tn) / total : 0;
        console.log(_chalk.default.dim('  Confusion: ') + _chalk.default.green(`TP=${cm.tp}`) + '  ' + _chalk.default.red(`FP=${cm.fp}`) + '  ' + _chalk.default.green(`TN=${cm.tn}`) + '  ' + _chalk.default.red(`FN=${cm.fn}`));
        console.log(_chalk.default.dim('  Precision: ') + _chalk.default.white.bold(`${(precision * 100).toFixed(1)}%`) + _chalk.default.dim('  Recall: ') + _chalk.default.white.bold(`${(recall * 100).toFixed(1)}%`) + _chalk.default.dim('  Accuracy: ') + _chalk.default.white.bold(`${(accuracy * 100).toFixed(1)}%`));
        const decided = wins + losses;
        const winRate = decided > 0 ? wins / decided * 100 : 0;
        console.log(_chalk.default.dim('  Trades: ') + _chalk.default.white.bold(String(totalTrades)) + _chalk.default.dim(' | Win: ') + _chalk.default.green.bold(String(wins)) + _chalk.default.dim(' | Loss: ') + _chalk.default.red.bold(String(losses)) + _chalk.default.dim(' | Neutral: ') + _chalk.default.gray(String(neutrals)));
        console.log(_chalk.default.dim('  Win Rate: ') + (winRate >= 55 ? _chalk.default.green.bold(`${winRate.toFixed(1)}%`) : winRate >= 45 ? _chalk.default.yellow.bold(`${winRate.toFixed(1)}%`) : _chalk.default.red.bold(`${winRate.toFixed(1)}%`)) + _chalk.default.dim(' | P/L: ') + colorPnl(cumPnl));
        console.log(`${divider}\n`);
    }
    constructor(threshold, tpPct, slPct){
        this.threshold = threshold;
        this.tpPct = tpPct;
        this.slPct = slPct;
    }
};

//# sourceMappingURL=logger.js.map