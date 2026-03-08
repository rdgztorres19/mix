export declare const ML_FEATURE_KEYS: readonly ["candle_idx", "open", "high", "low", "close", "volume", "atr", "vwap", "high_of_day", "low_of_day", "change_pct_at_candle", "ema9", "ema20", "pre_market_high", "shares_outstanding", "market_cap", "gap_pct", "premarket_volume", "momentum_acumulado", "change_1m", "change_5m", "change_10m", "minutes_since_hod"];
export type MlFeatures = Partial<Record<typeof ML_FEATURE_KEYS[number], number>>;
export interface PredictResult {
    tradeable: boolean;
    prob: number;
    threshold: number;
    error?: string;
}
export interface EvaluateResult {
    threshold_comparison: Array<{
        thr: number;
        recall_1: number;
        prec_1: number;
        pred_1: number;
    }>;
    threshold: number;
    classification: {
        '0': {
            precision: number;
            recall: number;
            f1: number;
        };
        '1': {
            precision: number;
            recall: number;
            f1: number;
        };
    };
    confusion_matrix: number[][];
}
export declare class PredictorService {
    private readonly logger;
    private readonly scriptPath;
    private readonly evaluateScriptPath;
    constructor();
    evaluate(threshold?: number): Promise<EvaluateResult>;
    predict(features: MlFeatures, threshold?: number): Promise<PredictResult>;
}
