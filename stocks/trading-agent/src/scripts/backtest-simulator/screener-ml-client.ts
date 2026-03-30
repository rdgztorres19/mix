import { spawn, execSync } from 'child_process';
import path from 'path';

export interface ScreenerProfile {
  price: number;
  gap_pct: number;
  premarket_volume: number;
  shares_outstanding: number;
  market_cap: number;
  atr_pct: number;
  volume_at_entry: number;
  dist_hod_pct: number;
  time_of_first_entry_min: number;
  in_gapper: number;
  in_gainer_session: number;
  in_gainer_intraday: number;
  in_high_session: number;
  in_high_current: number;
  rank_gapper: number;
  rank_gainer_session: number;
  rank_gainer_intraday: number;
  rank_high_session: number;
  rank_high_current: number;
  num_ranking_types: number;
  max_metric_value: number;
  combined_rank: number;
}

export class ScreenerMLClient {
  private readonly scriptPath: string;
  private readonly pythonBin: string;

  constructor() {
    const stockTraining = path.resolve(
      process.cwd(),
      process.env.STOCK_TRAINING_PATH ?? path.join('..', 'stock-training'),
    );
    this.scriptPath = path.join(stockTraining, 'ml', 'experiments', 'predict_screener_batch.py');

    try {
      this.pythonBin = execSync('which python3', { encoding: 'utf-8' }).trim();
    } catch {
      this.pythonBin = 'python3';
    }
  }

  async scoreBatch(profiles: ScreenerProfile[]): Promise<number[]> {
    if (!profiles.length) return [];

    const input = JSON.stringify({ batch: profiles });

    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonBin, [this.scriptPath], {
        cwd: path.dirname(this.scriptPath),
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
          const out = JSON.parse(stdout) as { error?: string; results?: { score: number }[] };
          if (out.error) reject(new Error(out.error));
          else resolve((out.results ?? []).map((r) => r.score));
        } catch {
          reject(new Error(stderr || `predict_screener exit ${code}, stdout=${stdout.slice(0, 500)}`));
        }
      });
      proc.stdin.write(input, () => proc.stdin.end());
    });
  }
}
