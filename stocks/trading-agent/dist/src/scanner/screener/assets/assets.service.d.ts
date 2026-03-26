import { OnModuleInit } from '@nestjs/common';
import { ScreenerRepository } from '../persistence/screener.repository';
import { AlpacaScreenerClient } from '../alpaca/alpaca-screener.client';
export declare class AssetsService implements OnModuleInit {
    private readonly repo;
    private readonly alpaca;
    private readonly logger;
    constructor(repo: ScreenerRepository, alpaca: AlpacaScreenerClient);
    onModuleInit(): Promise<void>;
    getAllSymbols(): Promise<string[]>;
}
