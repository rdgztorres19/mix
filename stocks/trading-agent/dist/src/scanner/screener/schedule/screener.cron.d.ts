import { RankingService } from '../ranking/ranking.service';
export declare class ScreenerCron {
    private readonly ranking;
    private readonly logger;
    constructor(ranking: RankingService);
    marketTick(): Promise<void>;
    postMarketHourly(): Promise<void>;
}
