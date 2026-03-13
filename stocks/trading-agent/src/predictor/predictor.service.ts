import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import { Observable, Subscriber } from 'rxjs';
import { MysqlTrainingRepository } from '../scanner/mysql/mysql-training.repository';

export interface CandleData {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface MlFeatures {
  /** Live mode: candle array + metadata */
  candles?: CandleData[];
  target_idx?: number;
  atr?: number;
  high_of_day?: number;
  low_of_day?: number;
  pre_market_high?: number;
  change_pct_at_candle?: number;
  /** Historical mode: ticker + date + time → NestJS fetches from MySQL */
  ticker?: string;
  date?: string;
  candle_time_et?: string;
}

export interface PredictResult {
  tradeable: boolean;
  prob: number;
  threshold: number;
  /** Present when the Python script returns an error response in JSON */
  error?: string;
}

export interface EvaluateResult {
  threshold_comparison: Array<{ thr: number; recall_1: number; prec_1: number; pred_1: number }>;
  threshold: number;
  classification: {
    '0': { precision: number; recall: number; f1: number };
    '1': { precision: number; recall: number; f1: number };
  };
  confusion_matrix: number[][];
}

export type TpSlResult = 'win' | 'loss' | 'neutral';

export interface BacktestRow {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  prob: number;
  tradeable: boolean;
  mfr: number;
  realGood: boolean;
  match: boolean;
  pnl: number;
  cumPnl: number;
  /** Precio de entrada (close de la vela señal) cuando tradeable */
  entryPrice?: number;
  /** Precio donde se alcanzó el beneficio (maxHigh en ventana MFR) o nivel TP/SL */
  exitPrice?: number;
  /** Vela/horario donde se alcanzó el beneficio */
  exitTime?: string;
  /** TP/SL: win = tocó TP antes que SL, loss = tocó SL primero, neutral = no tocó ninguno en 10 velas */
  tpSlResult?: TpSlResult;
}

export interface BacktestSummary {
  tp: number; fp: number; tn: number; fn: number;
  precision: number; recall: number; accuracy: number;
  signals: number; total: number;
  pnl: number; investment: number;
}

export interface BacktestResult {
  rows: BacktestRow[];
  summary: BacktestSummary | null;
  error?: string;
}

@Injectable()
export class PredictorService {
  private readonly logger = new Logger(PredictorService.name);
  private readonly scriptPath: string;
  private readonly evaluateScriptPath: string;

  constructor(private readonly mysqlRepo: MysqlTrainingRepository) {
    const stockTraining = path.resolve(
      process.cwd(),
      process.env.STOCK_TRAINING_PATH ?? path.join('..', 'stock-training'),
    );
    this.scriptPath = path.join(stockTraining, 'ml', 'experiments', 'predict.py');
    this.evaluateScriptPath = path.join(stockTraining, 'ml', 'random_forest', 'evaluate.py');
  }

  async evaluate(threshold = 0.5): Promise<EvaluateResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn('python3', [this.evaluateScriptPath, '--json', '--threshold', String(threshold)], {
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
          resolve(JSON.parse(stdout) as EvaluateResult);
        } catch {
          reject(new Error(`Invalid evaluate output: ${stdout}`));
        }
      });
    });
  }

  async predict(features: MlFeatures, threshold = 0.3): Promise<PredictResult> {
    let payload: Record<string, unknown>;

    if (features.ticker && features.date && features.candle_time_et) {
      // Historical mode: fetch candle data from MySQL, convert to candles array for Python
      const rows = await this.mysqlRepo.getTickerRowsForDate(features.ticker, features.date, '1m');

      if (!rows.length) {
        return { tradeable: false, prob: 0, threshold, error: `No data for ${features.ticker} on ${features.date}` };
      }

      // Find target row index by candle_time_et
      let targetIdx = rows.length - 1;
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i].candle_time_et) === features.candle_time_et) {
          targetIdx = i;
        }
      }

      // Convert MySQL rows to candle format for Python
      const candles = rows.map((r, i) => ({
        t: i,
        o: Number(r.open ?? 0),
        h: Number(r.high ?? 0),
        l: Number(r.low ?? 0),
        c: Number(r.close ?? 0),
        v: Number(r.volume ?? 0),
      }));

      // Pass candle_time_et and candle_idx arrays from MySQL so Python can
      // derive correct time-based and index-based features
      const candleTimesEt = rows.map((r) => String(r.candle_time_et ?? '09:30'));
      const candleIdxArr = rows.map((r) => Number(r.candle_idx ?? 0));

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
        _threshold: threshold,
      };
      this.logger.log(`Historical predict: ${features.ticker} ${features.date} ${features.candle_time_et} (${rows.length} candles, target=${targetIdx})`);
    } else {
      // Live mode: pass through candles array as-is
      payload = { ...features, _threshold: threshold };
    }

    const input = JSON.stringify(payload);

    return new Promise((resolve, reject) => {
      const proc = spawn('python3', [this.scriptPath], {
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
          const result = JSON.parse(stdout) as PredictResult;
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        } catch {
          reject(new Error(`Invalid predict output: ${stdout}`));
        }
      });

      proc.stdin.write(input, () => proc.stdin.end());
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * Simulate: did price hit +TP% before -SL% in next N candles?
   * Returns tpSlResult plus exitPrice/exitTime when TP or SL is hit.
   */
  private computeTpSlExit(
    rows: Record<string, unknown>[],
    idx: number,
    tpPct: number,
    slPct: number,
    lookAhead = 10,
  ): { tpSlResult: TpSlResult; exitPrice?: number; exitTime?: string } {
    const refClose = Number(rows[idx]?.close ?? 0);
    if (refClose <= 0) return { tpSlResult: 'neutral' };
    const levelUp = refClose * (1 + tpPct);
    const levelDown = refClose * (1 - slPct);
    let prevClose = refClose;
    const n = Math.min(lookAhead, rows.length - idx - 1);
    for (let j = 1; j <= n; j++) {
      const r = rows[idx + j];
      if (!r) break;
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
      if (touchUp) return { tpSlResult: 'win', exitPrice: levelUp, exitTime: String(r.candle_time_et ?? '') };
      if (touchDown) return { tpSlResult: 'loss', exitPrice: levelDown, exitTime: String(r.candle_time_et ?? '') };
      prevClose = closeJ;
    }
    return { tpSlResult: 'neutral' };
  }

  /**
   * Compute max future return over next N candles.
   * Returns mfr plus exitPrice/exitTime when future candles are available.
   * (max(high[t+1..t+N]) - close[t]) / close[t]
   */
  private computeMfr(
    rows: Record<string, unknown>[],
    idx: number,
    lookAhead = 10,
  ): { mfr: number; exitPrice?: number; exitTime?: string } {
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
      if (dbVal != null) return { mfr: Number(dbVal) };
    }
    return { mfr: 0 };
  }

  // ─── Backtest: candle-by-candle predict over a date/time range ─────────

  async backtest(
    ticker: string,
    dateStr: string,
    fromTime: string,
    toTime: string,
    threshold: number,
    investment: number,
  ): Promise<BacktestResult> {
    const rows = await this.mysqlRepo.getTickerRowsForDate(ticker.toUpperCase(), dateStr, '1m');
    if (!rows.length) {
      return { rows: [], summary: null, error: `No data for ${ticker} on ${dateStr}` };
    }

    const toMin = (t: string) => {
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

    // Filter rows in time window
    const targets: { idx: number; time: string }[] = [];
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
    const resultRows: BacktestRow[] = [];

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
      } catch {
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

  // ─── Backtest SSE stream ────────────────────────────────────────────

  backtestStream(
    ticker: string,
    dateStr: string,
    fromTime: string,
    toTime: string,
    threshold: number,
    investment: number,
    tpPct = 1.5,
    slPct = 1.5,
    lookAhead = 10,
  ): Observable<MessageEvent> {
    return new Observable((subscriber: Subscriber<MessageEvent>) => {
      this._runBacktestStream(subscriber, ticker, dateStr, fromTime, toTime, threshold, investment, tpPct, slPct, lookAhead);
    });
  }

  private async _runBacktestStream(
    sub: Subscriber<MessageEvent>,
    ticker: string,
    dateStr: string,
    fromTime: string,
    toTime: string,
    threshold: number,
    investment: number,
    tpPct: number,
    slPct: number,
    lookAhead: number,
  ) {
    try {
      const rows = await this.mysqlRepo.getTickerRowsForDate(ticker.toUpperCase(), dateStr, '1m');
      if (!rows.length) {
        sub.next({ data: { type: 'error', message: `No data for ${ticker} on ${dateStr}` } } as MessageEvent);
        sub.complete();
        return;
      }

      const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      const fromMin = toMin(fromTime);
      const toMinVal = toMin(toTime);

      const allCandles = rows.map((r, i) => ({
        t: i, o: Number(r.open ?? 0), h: Number(r.high ?? 0),
        l: Number(r.low ?? 0), c: Number(r.close ?? 0), v: Number(r.volume ?? 0),
      }));
      const candleTimesEt = rows.map((r) => String(r.candle_time_et ?? '09:30'));
      const candleIdxArr = rows.map((r) => Number(r.candle_idx ?? 0));

      const targets: { idx: number; time: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const t = String(rows[i].candle_time_et ?? '');
        const m = toMin(t);
        if (m >= fromMin && m <= toMinVal) targets.push({ idx: i, time: t });
      }

      if (!targets.length) {
        sub.next({ data: { type: 'error', message: `No candles in ${fromTime}–${toTime}` } } as MessageEvent);
        sub.complete();
        return;
      }

      // Send total count so frontend can show progress
      sub.next({ data: { type: 'info', total: targets.length, ticker, date: dateStr } } as MessageEvent);

      const tpDec = tpPct / 100;
      const slDec = slPct / 100;
      let tp = 0, fp = 0, tn = 0, fn = 0, cumPnL = 0;

      for (let n = 0; n < targets.length; n++) {
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
          _threshold: threshold,
        };

        let prob = 0, tradeable = false;
        try {
          const result = await this.callPredictRaw(payload);
          prob = result.prob ?? 0;
          tradeable = result.tradeable ?? false;
        } catch { /* skip */ }

        const { mfr, exitPrice: mfrExitPrice, exitTime: mfrExitTime } = this.computeMfr(rows, idx, lookAhead);
        const { tpSlResult, exitPrice: tpSlExitPrice, exitTime: tpSlExitTime } = this.computeTpSlExit(rows, idx, tpDec, slDec, lookAhead);
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

        const row: BacktestRow = {
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

        sub.next({ data: { type: 'row', row, progress: n + 1 } } as MessageEvent);
      }

      // Final summary
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
      } } as MessageEvent);

      sub.complete();
    } catch (err) {
      sub.next({ data: { type: 'error', message: err.message } } as MessageEvent);
      sub.complete();
    }
  }

  /**
   * Get 1m candles for backtest popup: from entry candle forward.
   * Used when user clicks a tradeable row to see entry → exit chart.
   */
  /** Normalize HH:MM or HH:MM:SS to HH:MM for matching */
  private normalizeTimeEt(s: string): string {
    const t = String(s ?? '').trim();
    if (t.length >= 5) return t.slice(0, 5); // "09:40" or "09:40:00" -> "09:40"
    return t;
  }

  async getBacktestCandles(
    ticker: string,
    dateStr: string,
    fromTime: string,
    count = 12,
  ): Promise<{ candles: CandleData[] }> {
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

  private rowsToCandleData(rows: Record<string, unknown>[], dateStr: string): CandleData[] {
    const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
    const candles: CandleData[] = [];
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

  private callPredictRaw(payload: Record<string, unknown>): Promise<PredictResult> {
    const input = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const proc = spawn('python3', [this.scriptPath], {
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
          resolve(JSON.parse(stdout) as PredictResult);
        } catch {
          reject(new Error(stderr || `exit ${code}`));
        }
      });
      proc.stdin.write(input, () => proc.stdin.end());
    });
  }
}
