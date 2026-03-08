import { Controller, Post, Get, Body, Query, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { IsNumber, IsOptional, Min, Max } from 'class-validator';
import { PredictorService, MlFeatures } from './predictor.service';

class PredictDto implements MlFeatures {
  @IsOptional() candle_idx?: number;
  @IsOptional() open?: number;
  @IsOptional() high?: number;
  @IsOptional() low?: number;
  @IsOptional() close?: number;
  @IsOptional() volume?: number;
  @IsOptional() atr?: number;
  @IsOptional() vwap?: number;
  @IsOptional() high_of_day?: number;
  @IsOptional() low_of_day?: number;
  @IsOptional() change_pct_at_candle?: number;
  @IsOptional() ema9?: number;
  @IsOptional() ema20?: number;
  @IsOptional() pre_market_high?: number;
  @IsOptional() shares_outstanding?: number;
  @IsOptional() market_cap?: number;
  @IsOptional() gap_pct?: number;
  @IsOptional() premarket_volume?: number;
  @IsOptional() momentum_acumulado?: number;
  @IsOptional() change_1m?: number;
  @IsOptional() change_5m?: number;
  @IsOptional() change_10m?: number;
  @IsOptional() minutes_since_hod?: number;
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
}
