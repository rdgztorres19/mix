import { Observable } from 'rxjs';
import { PredictorService, MlFeatures, CandleData } from './predictor.service';
declare class CandleDto implements CandleData {
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
}
declare class PredictDto implements MlFeatures {
    candles?: CandleDto[];
    target_idx?: number;
    atr?: number;
    high_of_day?: number;
    low_of_day?: number;
    pre_market_high?: number;
    change_pct_at_candle?: number;
    ticker?: string;
    date?: string;
    candle_time_et?: string;
}
export declare class PredictorController {
    private readonly predictor;
    private readonly logger;
    constructor(predictor: PredictorService);
    predict(body: PredictDto, thresholdStr?: string): Promise<import("./predictor.service").PredictResult>;
    evaluate(thresholdStr?: string): Promise<import("./predictor.service").EvaluateResult>;
    getBacktestCandles(ticker: string, date: string, fromTime: string, countStr?: string): Promise<{
        candles: CandleData[];
    }>;
    backtestStream(ticker: string, date: string, fromTime?: string, toTime?: string, thresholdStr?: string, investmentStr?: string, tpPctStr?: string, slPctStr?: string): Observable<MessageEvent>;
    backtest(body: {
        ticker: string;
        date: string;
        fromTime?: string;
        toTime?: string;
        threshold?: number;
        investment?: number;
    }): Promise<import("./predictor.service").BacktestResult>;
}
export {};
