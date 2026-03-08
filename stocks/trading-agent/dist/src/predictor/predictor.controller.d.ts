import { PredictorService, MlFeatures } from './predictor.service';
declare class PredictDto implements MlFeatures {
    candle_idx?: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
    atr?: number;
    vwap?: number;
    high_of_day?: number;
    low_of_day?: number;
    change_pct_at_candle?: number;
    ema9?: number;
    ema20?: number;
    pre_market_high?: number;
    shares_outstanding?: number;
    market_cap?: number;
    gap_pct?: number;
    premarket_volume?: number;
    momentum_acumulado?: number;
    change_1m?: number;
    change_5m?: number;
    change_10m?: number;
    minutes_since_hod?: number;
}
export declare class PredictorController {
    private readonly predictor;
    private readonly logger;
    constructor(predictor: PredictorService);
    predict(body: PredictDto, thresholdStr?: string): Promise<import("./predictor.service").PredictResult>;
    evaluate(thresholdStr?: string): Promise<import("./predictor.service").EvaluateResult>;
}
export {};
