import { Controller, Post, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { IsString, IsNumber, IsOptional, Min } from 'class-validator';
import { AgentService, AnalyzeResponse } from './agent.service';

class AnalyzeDto {
  @IsString()
  ticker: string;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  account_size?: number;

  @IsOptional()
  @IsNumber()
  cutoff_ms?: number;
}

@Controller('agent')
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(private readonly agentService: AgentService) {}

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
}
