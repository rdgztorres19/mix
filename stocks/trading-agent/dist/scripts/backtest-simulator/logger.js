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
const REASON_LABELS = {
    gapper: 'GAP',
    gainer_session: 'GAIN_S',
    gainer_intraday: 'GAIN_I',
    high_session: 'HOD_S',
    high_current: 'HOD_C'
};
function formatReasons(reasons) {
    if (!reasons || reasons.size === 0) return '';
    return [
        ...reasons
    ].map((r)=>REASON_LABELS[r] ?? r).join(',');
}
let SimLogger = class SimLogger {
    logMinute(minute, combinedList, reasons, signals) {
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
        console.log(`\n${'='.repeat(70)}`);
        console.log(`[${minute}] Combined: ${combinedList.length} symbols`);
        if (this.isFirstMinute) {
            // First minute: show full list with reasons
            for (const sym of combinedList){
                const r = formatReasons(reasons.get(sym));
                console.log(`  ${sym.padEnd(10)} [${r}]`);
            }
            this.isFirstMinute = false;
        } else {
            // Subsequent minutes: show only changes
            if (added.length === 0 && removed.length === 0) {
                console.log(`  No changes`);
            } else {
                if (added.length > 0) {
                    const addedStr = added.map((s)=>`${s}[${formatReasons(reasons.get(s))}]`).join(' ');
                    console.log(`  + Added (${added.length}): ${addedStr}`);
                }
                if (removed.length > 0) {
                    console.log(`  - Removed (${removed.length}): ${removed.join(', ')}`);
                }
            }
        }
        this.previousList = [
            ...combinedList
        ];
        // Signals
        const buySignals = signals.filter((s)=>s.tradeable);
        const skipSignals = signals.filter((s)=>!s.tradeable);
        if (buySignals.length > 0) {
            console.log(`\n  BUY signals (${buySignals.length}):`);
            for (const s of buySignals){
                const trade = s.trade;
                let tradeStr = '';
                if (trade) {
                    const resultLabel = trade.result === 'win' ? 'WIN' : trade.result === 'loss' ? 'LOSS' : 'NEUTRAL';
                    const pnl = trade.pnlPct >= 0 ? `+${trade.pnlPct.toFixed(2)}%` : `${trade.pnlPct.toFixed(2)}%`;
                    const exitInfo = trade.exitMinute ? ` exit@${trade.exitMinute}` : '';
                    tradeStr = ` -> ${resultLabel} ${pnl}${exitInfo}`;
                    this.recordTrade(s.symbol, s.prob, trade);
                }
                console.log(`    ${s.symbol} prob=${s.prob.toFixed(4)}${tradeStr}`);
            }
        }
        if (skipSignals.length > 0) {
            const skipSummary = skipSignals.slice(0, 10).map((s)=>`${s.symbol}(${s.prob.toFixed(2)})`).join(' ');
            const extra = skipSignals.length > 10 ? ` +${skipSignals.length - 10} more` : '';
            console.log(`  SKIP: ${skipSummary}${extra}`);
        }
        console.log(`  Predicted: ${signals.length} symbols (only current combined list)`);
        const winRate = this.totalSignals > 0 ? (this.wins / this.totalSignals * 100).toFixed(1) : '0.0';
        console.log(`  Running: signals=${this.totalSignals} W=${this.wins} L=${this.losses} N=${this.neutrals} winRate=${winRate}%`);
    }
    printSummary(config) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`BACKTEST SUMMARY: ${config.date} ${config.startTime}-${config.endTime}`);
        console.log(`Threshold=${config.threshold} TP=${config.targetPct}% SL=${config.stopLossPct}%`);
        console.log('='.repeat(70));
        const winRate = this.totalSignals > 0 ? (this.wins / this.totalSignals * 100).toFixed(1) : '0.0';
        console.log(`Total signals: ${this.totalSignals}`);
        console.log(`  Wins:     ${this.wins}`);
        console.log(`  Losses:   ${this.losses}`);
        console.log(`  Neutral:  ${this.neutrals}`);
        console.log(`  Win rate: ${winRate}%`);
        let totalPnl = 0;
        for (const stats of this.perSymbol.values()){
            totalPnl += stats.totalPnlPct;
        }
        const avgPnl = this.totalSignals > 0 ? (totalPnl / this.totalSignals).toFixed(2) : '0.00';
        console.log(`  Avg PnL:  ${avgPnl}%`);
        // Per-symbol breakdown
        if (this.perSymbol.size > 0) {
            console.log(`\nPer-symbol breakdown:`);
            const sorted = [
                ...this.perSymbol.entries()
            ].sort((a, b)=>b[1].signals - a[1].signals);
            for (const [sym, s] of sorted){
                const avg = s.signals > 0 ? (s.totalPnlPct / s.signals).toFixed(2) : '0.00';
                console.log(`  ${sym.padEnd(8)} ${s.signals} signals, ${s.wins}W ${s.losses}L ${s.neutrals}N, avgPnL=${avg}%`);
            }
        }
        // All symbols that appeared in scanner + their reasons
        console.log(`\nAll scanned symbols (${this.allReasons.size}) and why they were included:`);
        const sortedReasons = [
            ...this.allReasons.entries()
        ].sort((a, b)=>a[0].localeCompare(b[0]));
        for (const [sym, cats] of sortedReasons){
            console.log(`  ${sym.padEnd(10)} [${formatReasons(cats)}]`);
        }
        console.log('='.repeat(70));
    }
    recordTrade(symbol, prob, trade) {
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
    }
    constructor(){
        this.totalSignals = 0;
        this.wins = 0;
        this.losses = 0;
        this.neutrals = 0;
        this.perSymbol = new Map();
        this.previousList = [];
        this.isFirstMinute = true;
        /** Accumulated reasons: for each symbol, all categories it ever appeared in */ this.allReasons = new Map();
    }
};

//# sourceMappingURL=logger.js.map