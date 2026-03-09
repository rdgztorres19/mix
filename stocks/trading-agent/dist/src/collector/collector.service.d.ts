import { OnModuleInit } from '@nestjs/common';
import { MysqlTrainingRepository } from '../scanner/mysql/mysql-training.repository';
import { ScannerService } from '../scanner/scanner.service';
import { MomoStreamService } from './momo-stream.service';
import { CollectorGateway } from './collector.gateway';
import { CollectorCandle } from './indicator.calculator';
export declare class CollectorService implements OnModuleInit {
    private readonly mysqlRepo;
    private readonly scannerService;
    private readonly momoStream;
    private readonly gateway;
    private readonly logger;
    private readonly activeSymbols;
    private readonly momoBase;
    constructor(mysqlRepo: MysqlTrainingRepository, scannerService: ScannerService, momoStream: MomoStreamService, gateway: CollectorGateway);
    onModuleInit(): Promise<void>;
    addSymbol(symbol: string, source?: string, skipPersist?: boolean): Promise<void>;
    backfillFromMomo(symbol: string): Promise<void>;
    private onLiveTick;
    onCandleClosed(symbol: string, candle: CollectorCandle): Promise<void>;
    scanMomo(): Promise<string[]>;
    refreshAllFromMomo(): Promise<void>;
    getActiveSymbolList(): string[];
    private getTodayDateET;
}
