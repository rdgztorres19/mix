import { Controller, Post, Body, Get, Param, Query, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { AgentService, AnalyzeResponse } from './agent.service';
import { AnalysisLogService } from '../analysis-log/analysis-log.service';

class AnalyzeDto {
  @IsString()
  ticker: string;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  account_size?: number;

  @IsOptional()
  @IsString()
  timeframe?: '1m' | '5m';

  @IsOptional()
  @IsNumber()
  cutoff_ms?: number;
}

@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentService: AgentService,
    private readonly analysisLog: AnalysisLogService,
  ) {}

  /**
   * POST /agent/analyze
   * Body: { "ticker": "NVDA", "account_size": 25000 }
   *
   * Runs the full LangChain tool-calling agent to analyze a stock for day trading.
   * Returns: decision, entry, stop, targets, share size, R/R ratio, justification.
   */
  @Post('analyze')
  async analyze(@Body() body: AnalyzeDto): Promise<AnalyzeResponse> {
    if (!body.ticker) {
      throw new HttpException('ticker is required', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`POST /agent/analyze → ${body.ticker.toUpperCase()}`);

    try {
      const result = await this.agentService.analyze({
        ticker: body.ticker.toUpperCase(),
        account_size: body.account_size,
        timeframe: body.timeframe ?? '5m',
        cutoff_ms: body.cutoff_ms,
      });
      return result;
    } catch (err) {
      this.logger.error(`Analysis failed for ${body.ticker}:`, err.message);
      throw new HttpException(
        `Analysis failed: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /agent/logs?limit=50&ticker=NVDA
   * Returns analysis history for debugging.
   */
  @Get('logs')
  async getLogs(
    @Query('limit') limit?: string,
    @Query('ticker') ticker?: string,
  ) {
    const l = limit ? parseInt(limit, 10) : 50;
    return this.analysisLog.list(l, ticker);
  }

  /**
   * GET /agent/logs/:id
   * Returns full analysis log by ID (messages, tool calls, response).
   */
  @Get('logs/:id')
  async getLogById(@Param('id') id: string) {
    const entry = await this.analysisLog.getById(parseInt(id, 10));
    if (!entry) {
      throw new HttpException('Log not found', HttpStatus.NOT_FOUND);
    }
    return entry;
  }
}
