import { Injectable, Logger } from '@nestjs/common';
import type { AnalyzeRequest, AnalyzeResponse } from './pipeline';
import { AgenticPipeline } from './pipeline/agentic-pipeline';
import { FastPipeline } from './pipeline/fast-pipeline';

export type { AnalyzeRequest, AnalyzeResponse } from './pipeline';

/**
 * Thin orchestrator for stock analysis.
 *
 * Responsibilities:
 * - Route to agentic (tool-calling) or fast (deterministic) pipeline
 * - Log request start
 *
 * All analysis logic lives in:
 * - AgenticPipeline: LLM decides which tools to call (slower, flexible)
 * - FastPipeline: Deterministic early exits, single LLM only when qualified
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly agenticPipeline: AgenticPipeline,
    private readonly fastPipeline: FastPipeline,
  ) {}

  async analyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
    const { ticker, account_size = Number(process.env.DEFAULT_ACCOUNT_SIZE) || 25000, timeframe = '5m', cutoff_ms, fast } = req;
    const tStart = Date.now();

    this.logger.log(
      `[0.0s] Analyzing ${ticker} | account $${account_size} | ${timeframe}` +
        (cutoff_ms ? ` | SIMULATION up to ${new Date(cutoff_ms).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET` : '') +
        (fast ? ' | FAST (pipeline)' : ''),
    );

    if (fast) {
      return this.fastPipeline.run(req);
    }

    return this.agenticPipeline.run(req);
  }
}
