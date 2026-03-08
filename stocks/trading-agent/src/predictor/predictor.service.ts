import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';

/** Features requeridas por el modelo RF (orden importa para el script Python) */
export const ML_FEATURE_KEYS = [
  'candle_idx', 'open', 'high', 'low', 'close', 'volume', 'atr', 'vwap',
  'high_of_day', 'low_of_day', 'change_pct_at_candle', 'ema9', 'ema20',
  'pre_market_high', 'shares_outstanding', 'market_cap', 'gap_pct',
  'premarket_volume', 'momentum_acumulado', 'change_1m', 'change_5m',
  'change_10m', 'minutes_since_hod',
] as const;

export type MlFeatures = Partial<Record<typeof ML_FEATURE_KEYS[number], number>>;

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

  constructor() {
    const stockTraining = path.resolve(
      process.cwd(),
      process.env.STOCK_TRAINING_PATH ?? path.join('..', 'stock-training'),
    );
    this.scriptPath = path.join(stockTraining, 'ml', 'random_forest', 'predict.py');
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
    const payload = { ...features, _threshold: threshold };
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
