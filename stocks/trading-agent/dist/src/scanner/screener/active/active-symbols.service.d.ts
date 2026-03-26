import { ScreenerRepository } from '../persistence/screener.repository';
export declare class ActiveSymbolsService {
    private readonly repo;
    private readonly logger;
    constructor(repo: ScreenerRepository);
    private topN;
    rebuildFromStoredRanks(): Promise<{
        count: number;
    }>;
    getActive(): Promise<{
        rank_order: number;
        symbol: string;
        score: number;
    }[]>;
}
