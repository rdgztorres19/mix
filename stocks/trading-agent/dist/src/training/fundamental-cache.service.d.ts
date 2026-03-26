import { OnModuleInit } from '@nestjs/common';
import { MysqlTrainingRepository } from '../scanner/mysql/mysql-training.repository';
export interface Fundamentals {
    sharesOutstanding: number | null;
    marketCap: number | null;
}
export declare class FundamentalCacheService implements OnModuleInit {
    private readonly mysqlRepo;
    private readonly logger;
    private readonly cache;
    private envLoaded;
    constructor(mysqlRepo: MysqlTrainingRepository);
    onModuleInit(): Promise<void>;
    private ensureFinnhubKeyLoaded;
    private fetchFromFinnhub;
    getFundamentals(symbol: string): Promise<Fundamentals>;
}
