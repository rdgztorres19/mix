import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
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
}
