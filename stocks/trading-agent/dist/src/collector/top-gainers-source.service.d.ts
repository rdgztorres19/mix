import { ConfigService } from '@nestjs/config';
export type TopGainerSource = 'hpg' | 'alpaca_screener';
export declare enum TopGainerSourceEnum {
    HPG = "HPG",
    ALPACA = "ALPACA"
}
export declare function getTopGainerSourceFromEnv(): TopGainerSource;
export declare class TopGainersSourceService {
    private readonly configService;
    private readonly logger;
    constructor(configService: ConfigService);
    fetchFromHpg(): Promise<string[]>;
    fetchFromAlpacaScreener(): Promise<string[]>;
    fetchSymbols(source: TopGainerSource): Promise<string[]>;
}
