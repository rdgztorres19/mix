import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PredictionBundle, ModelPrediction, PredictionCategory } from '@small-caps/shared';
import { ChartService } from '../chart/chart.service';
import { StockProfileEntity } from '../database/entities/stock-profile.entity';
import { Candle1mEntity } from '../database/entities/candle-1m.entity';
import {
  MODEL_CONFIG,
  ModelConfig,
  PredictPayload,
  PythonPredictResult,
} from './predictor.types';

interface CacheEntry {
  bundle: PredictionBundle;
  createdAt: number;
}

@Injectable()
export class PredictorService {
  private readonly logger = new Logger(PredictorService.name);
  private readonly pythonBin = this.resolvePythonBin();
  private readonly mlDir = this.resolveMlDir();

  private resolvePythonBin(): string {
    if (process.env.ML_PYTHON_BIN) return process.env.ML_PYTHON_BIN;
    const fs = require('fs');
    const candidates = [
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12',
      '/usr/bin/python3',
    ];
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
    }
    return 'python3';
  }

  private resolveMlDir(): string {
    if (process.env.ML_DIR) return process.env.ML_DIR;
    const fs = require('fs');
    // Walk up from __dirname looking for a sibling `ml/predict_batch.py`
    let cur = __dirname;
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(cur, 'ml', 'predict_batch.py');
      if (fs.existsSync(candidate)) return path.join(cur, 'ml');
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    // Fallback — cwd-relative
    return path.resolve(process.cwd(), '../../ml');
  }
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 5 * 60_000;

  constructor(
    private readonly chartService: ChartService,
    @InjectRepository(StockProfileEntity)
    private readonly profileRepo: Repository<StockProfileEntity>,
    @InjectRepository(Candle1mEntity)
    private readonly candleRepo: Repository<Candle1mEntity>,
  ) {
    this.logger.log(`Python: ${this.pythonBin}`);
    this.logger.log(`ML dir: ${this.mlDir}`);
  }

  async predict(symbol: string, date: string, candleIdx: number): Promise<PredictionBundle> {
    const cacheKey = `${symbol}:${date}:${candleIdx}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.createdAt < this.cacheTtlMs) {
      return cached.bundle;
    }

    const payload = await this.buildPayload(symbol, date, candleIdx);
    if (!payload) {
      return this.emptyBundle(symbol, date, candleIdx);
    }

    const results = await Promise.all(
      MODEL_CONFIG.map((cfg) => this.runOne(cfg, payload)),
    );

    const bundle: PredictionBundle = {
      symbol,
      date,
      candleIdx,
      timestamp: now,
      short: results.filter((r) => r.category === 'short'),
      long: results.filter((r) => r.category === 'long'),
      volatility: results.filter((r) => r.category === 'volatility'),
    };

    this.cache.set(cacheKey, { bundle, createdAt: now });
    this.pruneCache(now);
    return bundle;
  }

  private async buildPayload(
    symbol: string,
    date: string,
    candleIdx: number,
  ): Promise<PredictPayload | null> {
    const candles = await this.chartService.getCandles(symbol, date, '1m');
    if (candles.length === 0 || candleIdx < 0) return null;
    const cap = Math.min(candleIdx, candles.length - 1);
    const slice = candles.slice(0, cap + 1);
    if (slice.length === 0) return null;

    // Fetch metadata from DB
    const [profile, candleRows] = await Promise.all([
      this.profileRepo.findOneBy({ symbol: symbol.toUpperCase() }),
      this.candleRepo.find({
        where: { symbol: symbol.toUpperCase(), date },
        order: { candle_idx: 'ASC' },
        select: ['candle_idx', 'candle_time_et', 'gap_pct', 'premarket_volume', 'pre_market_high'],
      }),
    ]);

    const metaRow = candleRows[0];
    const candleTimesEt = candleRows.slice(0, slice.length).map((r) => r.candle_time_et);
    const candleIdxArr = slice.map((_, i) => i);

    // Raw-candle payload — Python recomputes atr/hod/lod/change_pct
    const remapped = slice.map((c, i) => ({ t: i, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));

    return {
      candles: remapped,
      target_idx: remapped.length - 1,
      candle_times_et: candleTimesEt,
      candle_idx_arr: candleIdxArr,
      atr: 0,
      high_of_day: 0,
      low_of_day: 0,
      pre_market_high: Number(metaRow?.pre_market_high ?? 0) || 0,
      change_pct_at_candle: 0,
      shares_outstanding: Number(profile?.shares_outstanding ?? 0) || 0,
      market_cap: Number(profile?.market_cap ?? 0) || 0,
      gap_pct: Number(metaRow?.gap_pct ?? 0) || 0,
      premarket_volume: Number(metaRow?.premarket_volume ?? 0) || 0,
    };
  }

  private runOne(cfg: ModelConfig, payload: PredictPayload): Promise<ModelPrediction> {
    return new Promise((resolve) => {
      const scriptPath = path.join(this.mlDir, 'predict_batch.py');
      const input = JSON.stringify({ batch: [payload], _threshold: cfg.threshold });
      const proc = spawn(this.pythonBin, [scriptPath], {
        cwd: this.mlDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PREDICT_MODEL: cfg.key,
          PREDICT_THRESHOLD: String(cfg.threshold),
        },
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk) => (stdout += chunk.toString()));
      proc.stderr.on('data', (chunk) => (stderr += chunk.toString()));

      const failed = (err: string): ModelPrediction => ({
        modelKey: cfg.key,
        category: cfg.category,
        label: cfg.label,
        prob: 0,
        tradeable: false,
        threshold: cfg.threshold,
        error: err,
      });

      proc.on('error', (err) => {
        this.logger.error(`[${cfg.key}] spawn error: ${err.message}`);
        resolve(failed(err.message));
      });

      proc.on('close', () => {
        try {
          const out = JSON.parse(stdout) as { results?: PythonPredictResult[]; error?: string };
          if (out.error) {
            this.logger.warn(`[${cfg.key}] python error: ${out.error}`);
            resolve(failed(out.error));
            return;
          }
          const r = out.results?.[0];
          if (!r) {
            resolve(failed('no result'));
            return;
          }
          resolve({
            modelKey: cfg.key,
            category: cfg.category,
            label: cfg.label,
            prob: r.prob,
            tradeable: r.tradeable,
            threshold: cfg.threshold,
            error: r.ignored ? r.ignore_reason : undefined,
          });
        } catch (e) {
          this.logger.error(`[${cfg.key}] parse error: ${(e as Error).message} | stderr=${stderr.slice(0, 200)}`);
          resolve(failed('parse error'));
        }
      });

      proc.stdin.write(input, () => proc.stdin.end());
    });
  }

  private emptyBundle(symbol: string, date: string, candleIdx: number): PredictionBundle {
    return {
      symbol,
      date,
      candleIdx,
      timestamp: Date.now(),
      short: [],
      long: [],
      volatility: [],
    };
  }

  private pruneCache(now: number): void {
    if (this.cache.size < 500) return;
    for (const [k, v] of this.cache) {
      if (now - v.createdAt >= this.cacheTtlMs) this.cache.delete(k);
    }
  }
}
