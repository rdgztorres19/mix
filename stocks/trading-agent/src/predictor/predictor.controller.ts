import { Controller, Post, Get, Body, Query, Sse, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { IsOptional, IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Observable } from 'rxjs';
import { PredictorService, MlFeatures, CandleData } from './predictor.service';

class CandleDto implements CandleData {
  @IsOptional() t: number;
  @IsOptional() o: number;
  @IsOptional() h: number;
  @IsOptional() l: number;
  @IsOptional() c: number;
  @IsOptional() v: number;
}

class PredictDto implements MlFeatures {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CandleDto)
  candles?: CandleDto[];

  @IsOptional() target_idx?: number;
  @IsOptional() atr?: number;
  @IsOptional() high_of_day?: number;
  @IsOptional() low_of_day?: number;
  @IsOptional() pre_market_high?: number;
  @IsOptional() change_pct_at_candle?: number;

  /** Historical mode (NestJS handles MySQL lookup) */
  @IsOptional() @IsString() ticker?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() candle_time_et?: string;
}

@Controller('predict')
export class PredictorController {
  private readonly logger = new Logger(PredictorController.name);

  constructor(private readonly predictor: PredictorService) {}

  /**
   * POST /predict
   * Body: { "open": 5.2, "high": 5.5, "low": 5.1, "close": 5.4, ... }
   * Query: ?threshold=0.3 (opcional, default 0.3 para recall ~91%)
   *
   * Devuelve si se puede operar según el modelo RF entrenado.
   */
  @Post()
  async predict(
    @Body() body: PredictDto,
    @Query('threshold') thresholdStr?: string,
  ) {
    console.time(`Predict`);
    const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.3;
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      throw new HttpException('threshold must be between 0 and 1', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`POST /predict threshold=${threshold}`);

    try {
      const result = await this.predictor.predict(body as MlFeatures, threshold);
      return result;
    } catch (err) {
      this.logger.error(`Predict failed: ${err.message}`);
      throw new HttpException(
        `Predict failed: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      console.timeEnd(`Predict`);
    }
  }

  /**
   * GET /predict/evaluate?threshold=0.5
   * Ejecuta evaluate.py --json y devuelve métricas del modelo (recall, precisión, matriz de confusión).
   */
  @Get('evaluate')
  async evaluate(@Query('threshold') thresholdStr?: string) {
    const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.5;
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      throw new HttpException('threshold must be between 0 and 1', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`GET /predict/evaluate threshold=${threshold}`);

    try {
      const result = await this.predictor.evaluate(threshold);
      return result;
    } catch (err) {
      this.logger.error(`Evaluate failed: ${err.message}`);
      throw new HttpException(
        `Evaluate failed: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /predict/backtest-candles?ticker=X&date=YYYY-MM-DD&fromTime=09:35&count=12
   * Returns OHLC candles from entry candle forward for popup chart.
   */
  @Get('backtest-candles')
  async getBacktestCandles(
    @Query('ticker') ticker: string,
    @Query('date') date: string,
    @Query('fromTime') fromTime: string,
    @Query('count') countStr?: string,
  ) {
    if (!ticker || !date || !fromTime) {
      throw new HttpException('ticker, date and fromTime are required', HttpStatus.BAD_REQUEST);
    }
    const count = countStr ? parseInt(countStr, 10) : 12;
    if (isNaN(count) || count < 1 || count > 50) {
      throw new HttpException('count must be 1–50', HttpStatus.BAD_REQUEST);
    }
    try {
      return this.predictor.getBacktestCandles(ticker, date, fromTime, count);
    } catch (err) {
      this.logger.error(`getBacktestCandles failed: ${err.message}`);
      throw new HttpException(
        err.message || 'Failed to fetch candles',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * GET /predict/backtest/stream?ticker=X&date=2026-03-05&fromTime=09:30&toTime=16:00&threshold=0.6&investment=200
   * SSE stream: emits row-by-row backtest results in real time.
   */
  @Sse('backtest/stream')
  backtestStream(
    @Query('ticker') ticker: string,
    @Query('date') date: string,
    @Query('fromTime') fromTime?: string,
    @Query('toTime') toTime?: string,
    @Query('threshold') thresholdStr?: string,
    @Query('investment') investmentStr?: string,
  ): Observable<MessageEvent> {
    if (!ticker || !date) {
      throw new HttpException('ticker and date are required', HttpStatus.BAD_REQUEST);
    }
    const threshold = thresholdStr ? parseFloat(thresholdStr) : 0.6;
    const investment = investmentStr ? parseFloat(investmentStr) : 200;
    this.logger.log(`SSE /predict/backtest/stream ${ticker} ${date} ${fromTime ?? '09:30'}-${toTime ?? '16:00'} thr=${threshold}`);
    return this.predictor.backtestStream(ticker, date, fromTime ?? '09:30', toTime ?? '16:00', threshold, investment);
  }

  /**
   * POST /predict/backtest
   * Body: { ticker, date, fromTime, toTime, threshold?, investment? }
   * Runs candle-by-candle prediction over a historical window (same as debug-predict.js).
   */
  @Post('backtest')
  async backtest(
    @Body() body: { ticker: string; date: string; fromTime?: string; toTime?: string; threshold?: number; investment?: number },
  ) {
    const { ticker, date, fromTime = '09:30', toTime = '16:00' } = body;
    const threshold = body.threshold ?? 0.6;
    const investment = body.investment ?? 200;

    if (!ticker || !date) {
      throw new HttpException('ticker and date are required', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`POST /predict/backtest ${ticker} ${date} ${fromTime}-${toTime} thr=${threshold}`);

    try {
      const result = await this.predictor.backtest(ticker, date, fromTime, toTime, threshold, investment);
      if (result.error) {
        throw new HttpException(result.error, HttpStatus.NOT_FOUND);
      }
      return result;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`Backtest failed: ${err.message}`);
      throw new HttpException(
        `Backtest failed: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
