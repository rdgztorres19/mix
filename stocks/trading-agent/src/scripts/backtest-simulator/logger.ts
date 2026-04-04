import chalk from 'chalk';
import Table from 'cli-table3';
import type { ScreenerRankType } from '../../scanner/screener/persistence/screener.repository';
import type { TradeResult, SymbolStats, SimConfig } from './types';

interface MinuteSignal {
  symbol: string;
  prob: number;
  tradeable: boolean;
  trade?: TradeResult;
}

const REASON_LABELS: Record<ScreenerRankType, string> = {
  gapper: 'GAP',
  gainer_session: 'GAIN_S',
  gainer_intraday: 'GAIN_I',
  high_session: 'HOD_S',
  high_current: 'HOD_C',
};

const REASON_COLORS: Record<ScreenerRankType, (s: string) => string> = {
  gapper: chalk.magenta,
  gainer_session: chalk.cyan,
  gainer_intraday: chalk.blue,
  high_session: chalk.yellow,
  high_current: chalk.hex('#FFA500'),
};

function formatReasons(reasons: Set<ScreenerRankType> | undefined): string {
  if (!reasons || reasons.size === 0) return chalk.dim('—');
  return [...reasons]
    .map((r) => (REASON_COLORS[r] ?? chalk.white)(REASON_LABELS[r] ?? r))
    .join(chalk.dim(','));
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return chalk.white((vol / 1_000_000).toFixed(1) + 'M');
  if (vol >= 1_000) return chalk.white((vol / 1_000).toFixed(0) + 'K');
  return chalk.white(String(vol));
}

function colorPnl(pnlPct: number): string {
  const str = pnlPct >= 0 ? `+${pnlPct.toFixed(2)}%` : `${pnlPct.toFixed(2)}%`;
  if (pnlPct > 0) return chalk.green.bold(str);
  if (pnlPct < 0) return chalk.red.bold(str);
  return chalk.gray(str);
}

function colorResult(result: string): string {
  if (result === 'win') return chalk.bgGreen.black.bold(' WIN ');
  if (result === 'loss') return chalk.bgRed.white.bold(' LOSS ');
  return chalk.bgGray.white(' NEUT ');
}

function colorProb(prob: number, threshold: number): string {
  const pct = (prob * 100).toFixed(1) + '%';
  if (prob >= threshold) return chalk.green.bold(pct);
  if (prob >= threshold * 0.9) return chalk.yellow(pct);
  return chalk.dim(pct);
}

function bar(wins: number, losses: number, neutrals: number, width = 20): string {
  const total = wins + losses + neutrals;
  if (total === 0) return chalk.dim('░'.repeat(width));
  const wLen = Math.round((wins / total) * width);
  const lLen = Math.round((losses / total) * width);
  const nLen = width - wLen - lLen;
  return chalk.green('█'.repeat(wLen)) + chalk.red('█'.repeat(lLen)) + chalk.gray('░'.repeat(Math.max(0, nLen)));
}

export class SimLogger {
  private totalSignals = 0;
  private wins = 0;
  private losses = 0;
  private neutrals = 0;
  private volExpHits = 0;
  private volExpTotal = 0;
  private readonly perSymbol = new Map<string, SymbolStats>();
  private previousList: string[] = [];
  private isFirstMinute = true;
  private threshold = 0.65;

  /** Accumulated reasons: for each symbol, all categories it ever appeared in */
  private readonly allReasons = new Map<string, Set<ScreenerRankType>>();

  /** First minute each symbol appeared in the combined list */
  private readonly firstSeen = new Map<string, string>();

  /** Per-symbol list of trade timestamps with outcome */
  private readonly tradeLog = new Map<string, string[]>();

  /** Per-symbol market data (updated each minute from snapshots) */
  private readonly symbolMarket = new Map<string, {
    prevClose: number;
    open: number;
    lastPrice: number;
    hodPrice: number;   // highest high seen
    totalVol: number;
    maxChangePct: number; // max % gain from prevClose
  }>();

  setThreshold(t: number): void {
    this.threshold = t;
  }

  /** Call each minute with the synthetic snapshots for all combined-list symbols */
  updateMarketData(
    snapshots: Record<string, { dailyBar?: { o: number; h: number; l: number; c: number; v: number }; prevDailyBar?: { c: number } }>,
    combinedList: string[],
  ): void {
    for (const sym of combinedList) {
      const snap = snapshots[sym];
      if (!snap?.dailyBar) continue;
      const prev = snap.prevDailyBar?.c ?? 0;
      const maxGainPct = prev > 0 ? ((snap.dailyBar.h - prev) / prev) * 100 : 0;

      const existing = this.symbolMarket.get(sym);
      if (!existing) {
        this.symbolMarket.set(sym, {
          prevClose: prev,
          open: snap.dailyBar.o,
          lastPrice: snap.dailyBar.c,
          hodPrice: snap.dailyBar.h,
          totalVol: snap.dailyBar.v,
          maxChangePct: maxGainPct,
        });
      } else {
        existing.lastPrice = snap.dailyBar.c;
        existing.totalVol = snap.dailyBar.v;
        if (snap.dailyBar.h > existing.hodPrice) existing.hodPrice = snap.dailyBar.h;
        if (maxGainPct > existing.maxChangePct) existing.maxChangePct = maxGainPct;
      }
    }
  }

  logMinute(
    minute: string,
    combinedList: string[],
    reasons: Map<string, Set<ScreenerRankType>>,
    signals: MinuteSignal[],
  ): void {
    // Track first time each symbol appears in combined list
    for (const sym of combinedList) {
      if (!this.firstSeen.has(sym)) this.firstSeen.set(sym, minute);
    }

    // Accumulate reasons
    for (const [sym, cats] of reasons) {
      let existing = this.allReasons.get(sym);
      if (!existing) {
        existing = new Set();
        this.allReasons.set(sym, existing);
      }
      for (const c of cats) existing.add(c);
    }

    const currentSet = new Set(combinedList);
    const prevSet = new Set(this.previousList);
    const added = combinedList.filter((s) => !prevSet.has(s));
    const removed = this.previousList.filter((s) => !currentSet.has(s));

    // Header
    console.log('');
    console.log(chalk.bgBlue.white.bold(` ${minute} `) + chalk.blue(` Combined: ${chalk.bold(String(combinedList.length))} symbols`));

    if (this.isFirstMinute) {
      // First minute: compact grid with reasons
      const cols = 3;
      const rows: string[] = [];
      for (const sym of combinedList) {
        const r = formatReasons(reasons.get(sym));
        rows.push(`  ${chalk.white.bold(sym.padEnd(8))} ${r}`);
      }
      // Print in columns
      const perCol = Math.ceil(rows.length / cols);
      for (let i = 0; i < perCol; i++) {
        const line = [];
        for (let c = 0; c < cols; c++) {
          const idx = c * perCol + i;
          if (idx < rows.length) line.push(rows[idx].padEnd(45));
        }
        console.log(line.join(''));
      }
      this.isFirstMinute = false;
    } else {
      if (added.length === 0 && removed.length === 0) {
        console.log(chalk.dim('  No changes'));
      } else {
        if (added.length > 0) {
          const addedStr = added
            .map((s) => chalk.green.bold(s) + chalk.dim('[') + formatReasons(reasons.get(s)) + chalk.dim(']'))
            .join(' ');
          console.log(`  ${chalk.green('+')} ${chalk.green(`Added (${added.length}):`)} ${addedStr}`);
        }
        if (removed.length > 0) {
          console.log(`  ${chalk.red('−')} ${chalk.red(`Removed (${removed.length}):`)} ${chalk.dim(removed.join(', '))}`);
        }
      }
    }

    this.previousList = [...combinedList];

    // Buy signals
    const buySignals = signals.filter((s) => s.tradeable);
    const skipSignals = signals.filter((s) => !s.tradeable);

    if (buySignals.length > 0) {
      console.log(`\n  ${chalk.bgGreen.black.bold(` BUY ${buySignals.length} `)}`);
      for (const s of buySignals) {
        const trade = s.trade;
        let tradeStr = '';
        if (trade) {
          const exitInfo = trade.exitMinute ? chalk.dim(` exit@${trade.exitMinute}`) : '';
          tradeStr = ` ${chalk.dim('→')} ${colorResult(trade.result)} ${colorPnl(trade.pnlPct)}${exitInfo}`;
          this.recordTrade(s.symbol, minute, s.prob, trade);
        }
        console.log(`    ${chalk.white.bold(s.symbol.padEnd(8))} ${colorProb(s.prob, this.threshold)}${tradeStr}`);
      }
    }

    if (skipSignals.length > 0) {
      const skipSummary = skipSignals
        .slice(0, 10)
        .map((s) => chalk.dim(s.symbol) + chalk.dim(`(${(s.prob * 100).toFixed(0)})`))
        .join(' ');
      const extra = skipSignals.length > 10 ? chalk.dim(` +${skipSignals.length - 10} more`) : '';
      console.log(`  ${chalk.dim('SKIP:')} ${skipSummary}${extra}`);
    }

    // Running stats bar
    const winRate = this.totalSignals > 0 ? (this.wins / this.totalSignals) * 100 : 0;
    const winRateStr = winRate >= 55 ? chalk.green.bold(`${winRate.toFixed(1)}%`) :
      winRate >= 45 ? chalk.yellow(`${winRate.toFixed(1)}%`) :
      chalk.red(`${winRate.toFixed(1)}%`);

    console.log(
      `  ${bar(this.wins, this.losses, this.neutrals, 25)} ` +
      chalk.dim('sig=') + chalk.white.bold(String(this.totalSignals)) +
      chalk.dim(' W=') + chalk.green(String(this.wins)) +
      chalk.dim(' L=') + chalk.red(String(this.losses)) +
      chalk.dim(' N=') + chalk.gray(String(this.neutrals)) +
      chalk.dim(' wr=') + winRateStr,
    );
  }

  printSummary(config: SimConfig): void {
    const divider = chalk.blue('═'.repeat(74));

    console.log(`\n${divider}`);
    console.log(chalk.bgBlue.white.bold('  BACKTEST SUMMARY  '));
    console.log(
      chalk.dim('  Date: ') + chalk.white.bold(config.date) +
      chalk.dim('  Time: ') + chalk.white.bold(`${config.startTime}-${config.endTime}`) +
      chalk.dim('  Thr: ') + chalk.yellow(String(config.threshold)) +
      chalk.dim('  TP: ') + chalk.green(`${config.targetPct}%`) +
      chalk.dim('  SL: ') + chalk.red(`${config.stopLossPct}%`),
    );
    console.log(divider);

    const winRate = this.totalSignals > 0
      ? (this.wins / this.totalSignals) * 100
      : 0;

    // Stats box
    const statsTable = new Table({
      chars: { top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐', bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘', left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼', right: '│', 'right-mid': '┤', middle: '│' },
      style: { head: ['cyan'], border: ['dim'] },
    });
    statsTable.push(
      [chalk.dim('Signals'), chalk.dim('Wins'), chalk.dim('Losses'), chalk.dim('Neutral'), chalk.dim('Win Rate'), chalk.dim('Avg PnL')],
    );

    let totalPnl = 0;
    for (const stats of this.perSymbol.values()) {
      totalPnl += stats.totalPnlPct;
    }
    const avgPnl = this.totalSignals > 0 ? totalPnl / this.totalSignals : 0;

    statsTable.push([
      chalk.white.bold(String(this.totalSignals)),
      chalk.green.bold(String(this.wins)),
      chalk.red.bold(String(this.losses)),
      chalk.gray(String(this.neutrals)),
      winRate >= 55 ? chalk.green.bold(`${winRate.toFixed(1)}%`) : winRate >= 45 ? chalk.yellow.bold(`${winRate.toFixed(1)}%`) : chalk.red.bold(`${winRate.toFixed(1)}%`),
      colorPnl(avgPnl),
    ]);
    console.log(statsTable.toString());

    // Visual bar
    console.log(`\n  ${bar(this.wins, this.losses, this.neutrals, 50)}`);
    console.log(`  ${chalk.green(`${this.wins}W`)} ${chalk.dim('/')} ${chalk.red(`${this.losses}L`)} ${chalk.dim('/')} ${chalk.gray(`${this.neutrals}N`)}`);

    // Vol expansion accuracy
    if (this.volExpTotal > 0) {
      const volPct = (this.volExpHits / this.volExpTotal) * 100;
      const volColor = volPct >= 70 ? chalk.green.bold : volPct >= 50 ? chalk.yellow : chalk.red;
      console.log(`\n  ${chalk.cyan.bold('Vol Expansion Accuracy')} (range >= 2×ATR in 10 candles)`);
      console.log(`  ${volColor(`${this.volExpHits}/${this.volExpTotal} = ${volPct.toFixed(1)}%`)} correct predictions`);
    }

    // Per-symbol breakdown table
    if (this.perSymbol.size > 0) {
      console.log(`\n${chalk.cyan.bold('  Per-Symbol Breakdown')}`);

      const symTable = new Table({
        head: ['Symbol', 'Sig', 'W', 'L', 'N', 'WR%', 'AvgPnL', 'Bar', 'Scanned', 'Trades'].map((h) => chalk.cyan(h)),
        chars: { top: '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐', bottom: '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘', left: '│', 'left-mid': '├', mid: '─', 'mid-mid': '┼', right: '│', 'right-mid': '┤', middle: '│' },
        style: { head: [], border: ['dim'] },
        colWidths: [10, 5, 4, 4, 4, 7, 9, 14, 9, null],
        wordWrap: true,
      });

      const sorted = [...this.perSymbol.entries()].sort(
        (a, b) => b[1].signals - a[1].signals,
      );

      for (const [sym, s] of sorted) {
        const avg = s.signals > 0 ? s.totalPnlPct / s.signals : 0;
        const wr = s.signals > 0 ? (s.wins / s.signals) * 100 : 0;
        const firstAt = this.firstSeen.get(sym) ?? '?';
        const trades = this.tradeLog.get(sym)?.join(', ') ?? '';

        symTable.push([
          chalk.white.bold(sym),
          chalk.white(String(s.signals)),
          chalk.green(String(s.wins)),
          chalk.red(String(s.losses)),
          chalk.gray(String(s.neutrals)),
          wr >= 55 ? chalk.green(`${wr.toFixed(0)}%`) : wr >= 45 ? chalk.yellow(`${wr.toFixed(0)}%`) : chalk.red(`${wr.toFixed(0)}%`),
          colorPnl(avg),
          bar(s.wins, s.losses, s.neutrals, 10),
          chalk.dim(firstAt),
          chalk.dim(trades),
        ]);
      }

      //console.log(symTable.toString());
    }

    // All scanned symbols — rich table
    console.log(`\n${chalk.cyan.bold('  All Scanned Symbols')} ${chalk.dim(`(${this.allReasons.size})`)}`);

    const scanTable = new Table({
      head: ['Symbol', 'Price', 'PrevCl', 'Gap%', 'MaxGain%', 'Volume', 'HOD', 'Seen', 'Reasons'].map(h => chalk.cyan(h)),
      chars: { top: '-', 'top-mid': '+', 'top-left': '+', 'top-right': '+', bottom: '-', 'bottom-mid': '+', 'bottom-left': '+', 'bottom-right': '+', left: '|', 'left-mid': '+', mid: '-', 'mid-mid': '+', right: '|', 'right-mid': '+', middle: '|' },
      style: { head: [], border: ['dim'] },
    });

    // Sort by maxChangePct descending
    const sortedScanned = [...this.allReasons.entries()].sort((a, b) => {
      const ma = this.symbolMarket.get(a[0])?.maxChangePct ?? 0;
      const mb = this.symbolMarket.get(b[0])?.maxChangePct ?? 0;
      return mb - ma;
    });

    for (const [sym, cats] of sortedScanned) {
      const m = this.symbolMarket.get(sym);
      const firstAt = this.firstSeen.get(sym) ?? '?';

      const gapPct = m && m.prevClose > 0 ? ((m.open - m.prevClose) / m.prevClose) * 100 : 0;
      const gapStr = gapPct > 0 ? chalk.green(`+${gapPct.toFixed(1)}%`) : gapPct < 0 ? chalk.red(`${gapPct.toFixed(1)}%`) : chalk.dim('0.0%');
      const maxGainStr = m ? (m.maxChangePct > 0 ? chalk.green.bold(`+${m.maxChangePct.toFixed(1)}%`) : chalk.red(`${m.maxChangePct.toFixed(1)}%`)) : chalk.dim('?');
      const volStr = m ? formatVolume(m.totalVol) : chalk.dim('?');

      scanTable.push([
        chalk.white.bold(sym),
        m ? chalk.white(m.lastPrice.toFixed(2)) : chalk.dim('?'),
        m ? chalk.dim(m.prevClose.toFixed(2)) : chalk.dim('?'),
        gapStr,
        maxGainStr,
        volStr,
        m ? chalk.yellow(m.hodPrice.toFixed(2)) : chalk.dim('?'),
        chalk.dim(firstAt),
        formatReasons(cats),
      ]);
    }

    // console.log(scanTable.toString());

    // console.log(`\n${divider}`);
  }

  private recordTrade(symbol: string, minute: string, prob: number, trade: TradeResult): void {
    this.totalSignals++;
    if (trade.result === 'win') this.wins++;
    else if (trade.result === 'loss') this.losses++;
    else this.neutrals++;

    let stats = this.perSymbol.get(symbol);
    if (!stats) {
      stats = { signals: 0, wins: 0, losses: 0, neutrals: 0, totalPnlPct: 0 };
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

  recordVolExp(hit: boolean): void {
    this.volExpTotal++;
    if (hit) this.volExpHits++;
  }

  getVolExpStats(): { hits: number; total: number; pct: number } {
    return {
      hits: this.volExpHits,
      total: this.volExpTotal,
      pct: this.volExpTotal > 0 ? (this.volExpHits / this.volExpTotal) * 100 : 0,
    };
  }
}
