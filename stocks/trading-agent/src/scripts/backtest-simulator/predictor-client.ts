import { spawn, execSync } from 'child_process';
import path from 'path';
import type { PredictPayload, PredictResult } from './types';

export class PredictorClient {
  private readonly batchScriptPath: string;
  private readonly pythonBin: string;

  constructor() {
    const stockTraining = path.resolve(
      process.cwd(),
      process.env.STOCK_TRAINING_PATH ?? path.join('..', 'stock-training'),
    );
    this.batchScriptPath = path.join(stockTraining, 'ml', 'experiments', 'predict_batch.py');

    // Resolve python3 absolute path to avoid PATH issues in child processes
    try {
      this.pythonBin = execSync('which python3', { encoding: 'utf-8' }).trim();
    } catch {
      this.pythonBin = 'python3';
    }

    console.log(`  [Predictor] python: ${this.pythonBin}`);
    console.log(`  [Predictor] script: ${this.batchScriptPath}`);
  }

  async predictBatch(payloads: PredictPayload[], threshold: number): Promise<PredictResult[]> {
    if (!payloads.length) return [];

    const input = JSON.stringify({ batch: payloads, _threshold: threshold });

    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonBin, [this.batchScriptPath], {
        cwd: path.dirname(this.batchScriptPath),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        try {
          const out = JSON.parse(stdout) as { error?: string; results?: PredictResult[] };
          if (out.error) reject(new Error(out.error));
          else resolve(out.results ?? []);
        } catch {
          reject(new Error(stderr || `predict_batch exit ${code}, stdout=${stdout.slice(0, 500)}`));
        }
      });
      proc.stdin.write(input, () => proc.stdin.end());
    });
  }
}
