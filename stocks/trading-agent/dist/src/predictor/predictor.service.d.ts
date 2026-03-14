import { Observable } from 'rxjs';
import { MysqlTrainingRepository } from '../scanner/mysql/mysql-training.repository';
export interface CandleData {
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
}
export interface MlFeatures {
    candles?: CandleData[];
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
export type TpSlResult = 'win' | 'loss' | 'neutral';
export interface BacktestRow {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    prob: number;
    tradeable: boolean;
    mfr: number;
    realGood: boolean;
    match: boolean;
    pnl: number;
    cumPnl: number;
    entryPrice?: number;
    exitPrice?: number;
    exitTime?: string;
    tpSlResult?: TpSlResult;
}
export interface BacktestSummary {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
    precision: number;
    recall: number;
    accuracy: number;
    signals: number;
    total: number;
    pnl: number;
    investment: number;
}
export interface BacktestResult {
    rows: BacktestRow[];
    summary: BacktestSummary | null;
    error?: string;
}
export declare class PredictorService {
    private readonly mysqlRepo;
    private readonly logger;
    private readonly scriptPath;
    private readonly batchScriptPath;
    private readonly evaluateScriptPath;
    constructor(mysqlRepo: MysqlTrainingRepository);
    evaluate(threshold?: number): Promise<EvaluateResult>;
    predict(features: MlFeatures, threshold?: number): Promise<PredictResult>;
    private computeTpSlExit;
    private computeMfr;
    backtest(ticker: string, dateStr: string, fromTime: string, toTime: string, threshold: number, investment: number): Promise<BacktestResult>;
    private _runSingleSymbolBacktest;
    backtestStream(ticker: string, dateStr: string, fromTime: string, toTime: string, threshold: number, investment: number, tpPct?: number, slPct?: number, lookAhead?: number): Observable<MessageEvent>;
    backtestStreamDay(dateStr: string, fromTime: string, toTime: string, threshold: number, investment: number, tpPct?: number, slPct?: number, lookAhead?: number, symbolsOverride?: string[]): Observable<MessageEvent>;
    private _runBacktestStreamDay;
    private _runBacktestStream;
    private normalizeTimeEt;
    getBacktestCandles(ticker: string, dateStr: string, fromTime: string, count?: number): Promise<{
        candles: CandleData[];
    }>;
    private rowsToCandleData;
    private callPredictRaw;
    private callPredictBatch;
}
