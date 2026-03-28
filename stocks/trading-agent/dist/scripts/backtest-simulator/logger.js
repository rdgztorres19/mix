"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "SimLogger", {
    enumerable: true,
    get: function() {
        return SimLogger;
    }
});
const _chalk = /*#__PURE__*/ _interop_require_default(require("chalk"));
const _clitable3 = /*#__PURE__*/ _interop_require_default(require("cli-table3"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const REASON_LABELS = {
    gapper: 'GAP',
    gainer_session: 'GAIN_S',
    gainer_intraday: 'GAIN_I',
    high_session: 'HOD_S',
    high_current: 'HOD_C'
};
const REASON_COLORS = {
    gapper: _chalk.default.magenta,
    gainer_session: _chalk.default.cyan,
    gainer_intraday: _chalk.default.blue,
    high_session: _chalk.default.yellow,
    high_current: _chalk.default.hex('#FFA500')
};
function formatReasons(reasons) {
    if (!reasons || reasons.size === 0) return _chalk.default.dim('—');
    return [
        ...reasons
    ].map((r)=>(REASON_COLORS[r] ?? _chalk.default.white)(REASON_LABELS[r] ?? r)).join(_chalk.default.dim(','));
}
function formatVolume(vol) {
    if (vol >= 1_000_000) return _chalk.default.white((vol / 1_000_000).toFixed(1) + 'M');
    if (vol >= 1_000) return _chalk.default.white((vol / 1_000).toFixed(0) + 'K');
    return _chalk.default.white(String(vol));
}
function colorPnl(pnlPct) {
    const str = pnlPct >= 0 ? `+${pnlPct.toFixed(2)}%` : `${pnlPct.toFixed(2)}%`;
    if (pnlPct > 0) return _chalk.default.green.bold(str);
    if (pnlPct < 0) return _chalk.default.red.bold(str);
    return _chalk.default.gray(str);
}
function colorResult(result) {
    if (result === 'win') return _chalk.default.bgGreen.black.bold(' WIN ');
    if (result === 'loss') return _chalk.default.bgRed.white.bold(' LOSS ');
    return _chalk.default.bgGray.white(' NEUT ');
}
function colorProb(prob, threshold) {
    const pct = (prob * 100).toFixed(1) + '%';
    if (prob >= threshold) return _chalk.default.green.bold(pct);
    if (prob >= threshold * 0.9) return _chalk.default.yellow(pct);
    return _chalk.default.dim(pct);
}
function bar(wins, losses, neutrals, width = 20) {
    const total = wins + losses + neutrals;
    if (total === 0) return _chalk.default.dim('░'.repeat(width));
    const wLen = Math.round(wins / total * width);
    const lLen = Math.round(losses / total * width);
    const nLen = width - wLen - lLen;
    return _chalk.default.green('█'.repeat(wLen)) + _chalk.default.red('█'.repeat(lLen)) + _chalk.default.gray('░'.repeat(Math.max(0, nLen)));
}
let SimLogger = class SimLogger {
    setThreshold(t) {
        this.threshold = t;
    }
    /** Call each minute with the synthetic snapshots for all combined-list symbols */ updateMarketData(snapshots, combinedList) {
        for (const sym of combinedList){
            const snap = snapshots[sym];
            if (!snap?.dailyBar) continue;
            const prev = snap.prevDailyBar?.c ?? 0;
            const maxGainPct = prev > 0 ? (snap.dailyBar.h - prev) / prev * 100 : 0;
            const existing = this.symbolMarket.get(sym);
            if (!existing) {
                this.symbolMarket.set(sym, {
                    prevClose: prev,
                    open: snap.dailyBar.o,
                    lastPrice: snap.dailyBar.c,
                    hodPrice: snap.dailyBar.h,
                    totalVol: snap.dailyBar.v,
                    maxChangePct: maxGainPct
                });
            } else {
                existing.lastPrice = snap.dailyBar.c;
                existing.totalVol = snap.dailyBar.v;
                if (snap.dailyBar.h > existing.hodPrice) existing.hodPrice = snap.dailyBar.h;
                if (maxGainPct > existing.maxChangePct) existing.maxChangePct = maxGainPct;
            }
        }
    }
    logMinute(minute, combinedList, reasons, signals) {
        // Track first time each symbol appears in combined list
        for (const sym of combinedList){
            if (!this.firstSeen.has(sym)) this.firstSeen.set(sym, minute);
        }
        // Accumulate reasons
        for (const [sym, cats] of reasons){
            let existing = this.allReasons.get(sym);
            if (!existing) {
                existing = new Set();
                this.allReasons.set(sym, existing);
            }
            for (const c of cats)existing.add(c);
        }
        const currentSet = new Set(combinedList);
        const prevSet = new Set(this.previousList);
        const added = combinedList.filter((s)=>!prevSet.has(s));
        const removed = this.previousList.filter((s)=>!currentSet.has(s));
        // Header
        console.log('');
        console.log(_chalk.default.bgBlue.white.bold(` ${minute} `) + _chalk.default.blue(` Combined: ${_chalk.default.bold(String(combinedList.length))} symbols`));
        if (this.isFirstMinute) {
            // First minute: compact grid with reasons
            const cols = 3;
            const rows = [];
            for (const sym of combinedList){
                const r = formatReasons(reasons.get(sym));
                rows.push(`  ${_chalk.default.white.bold(sym.padEnd(8))} ${r}`);
            }
            // Print in columns
            const perCol = Math.ceil(rows.length / cols);
            for(let i = 0; i < perCol; i++){
                const line = [];
                for(let c = 0; c < cols; c++){
                    const idx = c * perCol + i;
                    if (idx < rows.length) line.push(rows[idx].padEnd(45));
                }
                console.log(line.join(''));
            }
            this.isFirstMinute = false;
        } else {
            if (added.length === 0 && removed.length === 0) {
                console.log(_chalk.default.dim('  No changes'));
            } else {
                if (added.length > 0) {
                    const addedStr = added.map((s)=>_chalk.default.green.bold(s) + _chalk.default.dim('[') + formatReasons(reasons.get(s)) + _chalk.default.dim(']')).join(' ');
                    console.log(`  ${_chalk.default.green('+')} ${_chalk.default.green(`Added (${added.length}):`)} ${addedStr}`);
                }
                if (removed.length > 0) {
                    console.log(`  ${_chalk.default.red('−')} ${_chalk.default.red(`Removed (${removed.length}):`)} ${_chalk.default.dim(removed.join(', '))}`);
                }
            }
        }
        this.previousList = [
            ...combinedList
        ];
        // Buy signals
        const buySignals = signals.filter((s)=>s.tradeable);
        const skipSignals = signals.filter((s)=>!s.tradeable);
        if (buySignals.length > 0) {
            console.log(`\n  ${_chalk.default.bgGreen.black.bold(` BUY ${buySignals.length} `)}`);
            for (const s of buySignals){
                const trade = s.trade;
                let tradeStr = '';
                if (trade) {
                    const exitInfo = trade.exitMinute ? _chalk.default.dim(` exit@${trade.exitMinute}`) : '';
                    tradeStr = ` ${_chalk.default.dim('→')} ${colorResult(trade.result)} ${colorPnl(trade.pnlPct)}${exitInfo}`;
                    this.recordTrade(s.symbol, minute, s.prob, trade);
                }
                console.log(`    ${_chalk.default.white.bold(s.symbol.padEnd(8))} ${colorProb(s.prob, this.threshold)}${tradeStr}`);
            }
        }
        if (skipSignals.length > 0) {
            const skipSummary = skipSignals.slice(0, 10).map((s)=>_chalk.default.dim(s.symbol) + _chalk.default.dim(`(${(s.prob * 100).toFixed(0)})`)).join(' ');
            const extra = skipSignals.length > 10 ? _chalk.default.dim(` +${skipSignals.length - 10} more`) : '';
            console.log(`  ${_chalk.default.dim('SKIP:')} ${skipSummary}${extra}`);
        }
        // Running stats bar
        const winRate = this.totalSignals > 0 ? this.wins / this.totalSignals * 100 : 0;
        const winRateStr = winRate >= 55 ? _chalk.default.green.bold(`${winRate.toFixed(1)}%`) : winRate >= 45 ? _chalk.default.yellow(`${winRate.toFixed(1)}%`) : _chalk.default.red(`${winRate.toFixed(1)}%`);
        console.log(`  ${bar(this.wins, this.losses, this.neutrals, 25)} ` + _chalk.default.dim('sig=') + _chalk.default.white.bold(String(this.totalSignals)) + _chalk.default.dim(' W=') + _chalk.default.green(String(this.wins)) + _chalk.default.dim(' L=') + _chalk.default.red(String(this.losses)) + _chalk.default.dim(' N=') + _chalk.default.gray(String(this.neutrals)) + _chalk.default.dim(' wr=') + winRateStr);
    }
    printSummary(config) {
        const divider = _chalk.default.blue('═'.repeat(74));
        console.log(`\n${divider}`);
        console.log(_chalk.default.bgBlue.white.bold('  BACKTEST SUMMARY  '));
        console.log(_chalk.default.dim('  Date: ') + _chalk.default.white.bold(config.date) + _chalk.default.dim('  Time: ') + _chalk.default.white.bold(`${config.startTime}-${config.endTime}`) + _chalk.default.dim('  Thr: ') + _chalk.default.yellow(String(config.threshold)) + _chalk.default.dim('  TP: ') + _chalk.default.green(`${config.targetPct}%`) + _chalk.default.dim('  SL: ') + _chalk.default.red(`${config.stopLossPct}%`));
        console.log(divider);
        const winRate = this.totalSignals > 0 ? this.wins / this.totalSignals * 100 : 0;
        // Stats box
        const statsTable = new _clitable3.default({
            chars: {
                top: '─',
                'top-mid': '┬',
                'top-left': '┌',
                'top-right': '┐',
                bottom: '─',
                'bottom-mid': '┴',
                'bottom-left': '└',
                'bottom-right': '┘',
                left: '│',
                'left-mid': '├',
                mid: '─',
                'mid-mid': '┼',
                right: '│',
                'right-mid': '┤',
                middle: '│'
            },
            style: {
                head: [
                    'cyan'
                ],
                border: [
                    'dim'
                ]
            }
        });
        statsTable.push([
            _chalk.default.dim('Signals'),
            _chalk.default.dim('Wins'),
            _chalk.default.dim('Losses'),
            _chalk.default.dim('Neutral'),
            _chalk.default.dim('Win Rate'),
            _chalk.default.dim('Avg PnL')
        ]);
        let totalPnl = 0;
        for (const stats of this.perSymbol.values()){
            totalPnl += stats.totalPnlPct;
        }
        const avgPnl = this.totalSignals > 0 ? totalPnl / this.totalSignals : 0;
        statsTable.push([
            _chalk.default.white.bold(String(this.totalSignals)),
            _chalk.default.green.bold(String(this.wins)),
            _chalk.default.red.bold(String(this.losses)),
            _chalk.default.gray(String(this.neutrals)),
            winRate >= 55 ? _chalk.default.green.bold(`${winRate.toFixed(1)}%`) : winRate >= 45 ? _chalk.default.yellow.bold(`${winRate.toFixed(1)}%`) : _chalk.default.red.bold(`${winRate.toFixed(1)}%`),
            colorPnl(avgPnl)
        ]);
        console.log(statsTable.toString());
        // Visual bar
        console.log(`\n  ${bar(this.wins, this.losses, this.neutrals, 50)}`);
        console.log(`  ${_chalk.default.green(`${this.wins}W`)} ${_chalk.default.dim('/')} ${_chalk.default.red(`${this.losses}L`)} ${_chalk.default.dim('/')} ${_chalk.default.gray(`${this.neutrals}N`)}`);
        // Per-symbol breakdown table
        if (this.perSymbol.size > 0) {
            console.log(`\n${_chalk.default.cyan.bold('  Per-Symbol Breakdown')}`);
            const symTable = new _clitable3.default({
                head: [
                    'Symbol',
                    'Sig',
                    'W',
                    'L',
                    'N',
                    'WR%',
                    'AvgPnL',
                    'Bar',
                    'Scanned',
                    'Trades'
                ].map((h)=>_chalk.default.cyan(h)),
                chars: {
                    top: '─',
                    'top-mid': '┬',
                    'top-left': '┌',
                    'top-right': '┐',
                    bottom: '─',
                    'bottom-mid': '┴',
                    'bottom-left': '└',
                    'bottom-right': '┘',
                    left: '│',
                    'left-mid': '├',
                    mid: '─',
                    'mid-mid': '┼',
                    right: '│',
                    'right-mid': '┤',
                    middle: '│'
                },
                style: {
                    head: [],
                    border: [
                        'dim'
                    ]
                },
                colWidths: [
                    10,
                    5,
                    4,
                    4,
                    4,
                    7,
                    9,
                    14,
                    9,
                    null
                ],
                wordWrap: true
            });
            const sorted = [
                ...this.perSymbol.entries()
            ].sort((a, b)=>b[1].signals - a[1].signals);
            for (const [sym, s] of sorted){
                const avg = s.signals > 0 ? s.totalPnlPct / s.signals : 0;
                const wr = s.signals > 0 ? s.wins / s.signals * 100 : 0;
                const firstAt = this.firstSeen.get(sym) ?? '?';
                const trades = this.tradeLog.get(sym)?.join(', ') ?? '';
                symTable.push([
                    _chalk.default.white.bold(sym),
                    _chalk.default.white(String(s.signals)),
                    _chalk.default.green(String(s.wins)),
                    _chalk.default.red(String(s.losses)),
                    _chalk.default.gray(String(s.neutrals)),
                    wr >= 55 ? _chalk.default.green(`${wr.toFixed(0)}%`) : wr >= 45 ? _chalk.default.yellow(`${wr.toFixed(0)}%`) : _chalk.default.red(`${wr.toFixed(0)}%`),
                    colorPnl(avg),
                    bar(s.wins, s.losses, s.neutrals, 10),
                    _chalk.default.dim(firstAt),
                    _chalk.default.dim(trades)
                ]);
            }
            console.log(symTable.toString());
        }
        // All scanned symbols — rich table
        console.log(`\n${_chalk.default.cyan.bold('  All Scanned Symbols')} ${_chalk.default.dim(`(${this.allReasons.size})`)}`);
        const scanTable = new _clitable3.default({
            head: [
                'Symbol',
                'Price',
                'PrevCl',
                'Gap%',
                'MaxGain%',
                'Volume',
                'HOD',
                'Seen',
                'Reasons'
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
        // Sort by maxChangePct descending
        const sortedScanned = [
            ...this.allReasons.entries()
        ].sort((a, b)=>{
            const ma = this.symbolMarket.get(a[0])?.maxChangePct ?? 0;
            const mb = this.symbolMarket.get(b[0])?.maxChangePct ?? 0;
            return mb - ma;
        });
        for (const [sym, cats] of sortedScanned){
            const m = this.symbolMarket.get(sym);
            const firstAt = this.firstSeen.get(sym) ?? '?';
            const gapPct = m && m.prevClose > 0 ? (m.open - m.prevClose) / m.prevClose * 100 : 0;
            const gapStr = gapPct > 0 ? _chalk.default.green(`+${gapPct.toFixed(1)}%`) : gapPct < 0 ? _chalk.default.red(`${gapPct.toFixed(1)}%`) : _chalk.default.dim('0.0%');
            const maxGainStr = m ? m.maxChangePct > 0 ? _chalk.default.green.bold(`+${m.maxChangePct.toFixed(1)}%`) : _chalk.default.red(`${m.maxChangePct.toFixed(1)}%`) : _chalk.default.dim('?');
            const volStr = m ? formatVolume(m.totalVol) : _chalk.default.dim('?');
            scanTable.push([
                _chalk.default.white.bold(sym),
                m ? _chalk.default.white(m.lastPrice.toFixed(2)) : _chalk.default.dim('?'),
                m ? _chalk.default.dim(m.prevClose.toFixed(2)) : _chalk.default.dim('?'),
                gapStr,
                maxGainStr,
                volStr,
                m ? _chalk.default.yellow(m.hodPrice.toFixed(2)) : _chalk.default.dim('?'),
                _chalk.default.dim(firstAt),
                formatReasons(cats)
            ]);
        }
        console.log(scanTable.toString());
        console.log(`\n${divider}`);
    }
    recordTrade(symbol, minute, prob, trade) {
        this.totalSignals++;
        if (trade.result === 'win') this.wins++;
        else if (trade.result === 'loss') this.losses++;
        else this.neutrals++;
        let stats = this.perSymbol.get(symbol);
        if (!stats) {
            stats = {
                signals: 0,
                wins: 0,
                losses: 0,
                neutrals: 0,
                totalPnlPct: 0
            };
            this.perSymbol.set(symbol, stats);
        }
        stats.signals++;
        if (trade.result === 'win') stats.wins++;
        else if (trade.result === 'loss') stats.losses++;
        else stats.neutrals++;
        stats.totalPnlPct += trade.pnlPct;
        // Log trade time + outcome + probability
        let log = this.tradeLog.get(symbol);
        if (!log) {
            log = [];
            this.tradeLog.set(symbol, log);
        }
        log.push(`${minute}(${trade.result === 'win' ? 1 : 0})(${(prob * 100).toFixed(0)}%)`);
    }
    constructor(){
        this.totalSignals = 0;
        this.wins = 0;
        this.losses = 0;
        this.neutrals = 0;
        this.perSymbol = new Map();
        this.previousList = [];
        this.isFirstMinute = true;
        this.threshold = 0.65;
        /** Accumulated reasons: for each symbol, all categories it ever appeared in */ this.allReasons = new Map();
        /** First minute each symbol appeared in the combined list */ this.firstSeen = new Map();
        /** Per-symbol list of trade timestamps with outcome */ this.tradeLog = new Map();
        /** Per-symbol market data (updated each minute from snapshots) */ this.symbolMarket = new Map();
    }
};

//# sourceMappingURL=logger.js.map