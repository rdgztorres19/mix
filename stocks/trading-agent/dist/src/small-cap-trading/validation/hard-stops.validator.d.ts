import type { MarketContext } from '../types';
export interface HardStopsResult {
    passed: boolean;
    failures: string[];
}
export declare class HardStopsValidator {
    validate(ctx: MarketContext): HardStopsResult;
    private checkChangePct;
    private checkRelativeVolume;
    private checkAtr;
    private checkSession;
    private checkPriceMin;
    private checkPriceMax;
    private checkVwap;
}
