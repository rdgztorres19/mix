import { type TrainingRowOutput } from '../training/training-row-builder';
import type { TrainingCandle } from '../training/types';
import { FundamentalCacheService } from '../training/fundamental-cache.service';
import { type SymbolMetadata } from './indicator.calculator';
import type { CollectorFeaturesTodayDto } from './dto/collector-features-today.dto';
type FeaturePreviewMetadata = SymbolMetadata & {
    openDay: number;
    openFirst: number;
    prevTradingDate: string;
};
type SymbolFeatureResult = {
    symbol: string;
    candlesCount: number;
    metadata: FeaturePreviewMetadata | null;
    rows: TrainingRowOutput[];
    candles?: TrainingCandle[];
    error?: string;
};
export declare class CollectorFeaturePreviewService {
    private readonly fundamentalCache;
    private readonly logger;
    private readonly fallbackEnv;
    constructor(fundamentalCache: FundamentalCacheService);
    private loadFallbackEnv;
    private getEnvAny;
    private marketDataHeaders;
    private etDateTimeToUtcIso;
    private fetchBarsWithExtendedHours;
    private todayEt;
    private prevTradingDay;
    private parseSymbols;
    private concurrency;
    buildFeaturesForSymbolsByDate(input: CollectorFeaturesTodayDto): Promise<{
        ok: boolean;
        date: string;
        results: SymbolFeatureResult[];
        error?: string;
    }>;
    private buildForOneSymbol;
}
export {};
