import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
export interface CachedCatalyst {
    strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
    catalyst_type: string;
    is_dilutive: boolean;
    justifies_move: boolean;
    headlines_sample: string[];
    cached_at: number;
}
export declare class NewsCacheService implements OnModuleInit, OnModuleDestroy {
    private readonly logger;
    private redis;
    private readonly ttlSec;
    private readonly keyPrefix;
    constructor();
    onModuleInit(): void;
    onModuleDestroy(): void;
    private key;
    get(ticker: string): Promise<CachedCatalyst | null>;
    set(ticker: string, catalyst: Omit<CachedCatalyst, 'cached_at'>): Promise<void>;
    invalidate(ticker: string): Promise<void>;
    ttlRemaining(ticker: string): Promise<number>;
}
