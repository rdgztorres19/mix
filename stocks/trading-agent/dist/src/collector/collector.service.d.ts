import { OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MysqlTrainingRepository } from '../scanner/mysql/mysql-training.repository';
import { ScannerService } from '../scanner/scanner.service';
import { MomoStreamService } from './momo-stream.service';
import { CollectorGateway } from './collector.gateway';
import { AutoTraderService } from '../trader/auto-trader.service';
import { CollectorCandle } from './indicator.calculator';
export declare class CollectorService implements OnModuleInit {
    private readonly moduleRef;
    private readonly mysqlRepo;
    private readonly scannerService;
    private readonly momoStream;
    private readonly gateway;
    private readonly autoTrader?;
    private readonly logger;
    private readonly activeSymbols;
    private readonly momoBase;
    private webSocketInit?;
    constructor(moduleRef: ModuleRef, mysqlRepo: MysqlTrainingRepository, scannerService: ScannerService, momoStream: MomoStreamService, gateway: CollectorGateway, autoTrader?: AutoTraderService);
    onModuleInit(): Promise<void>;
    addSymbol(symbol: string, source?: string, skipPersist?: boolean): Promise<void>;
    backfillFromMomo(symbol: string): Promise<void>;
    private onLiveTick;
    onCandleClosed(symbol: string, candle: CollectorCandle): Promise<void>;
    resetActiveSymbols(): Promise<void>;
    scanMomo(): Promise<string[]>;
    refreshAllFromMomo(options?: {
        force?: boolean;
    }): Promise<{
        skipped: boolean;
        reason?: string;
    }>;
    migrateToAlpacaIfAvailable(): Promise<void>;
    getActiveSymbolList(): string[];
    getDebugStatus(): {
        activeSymbols: string[];
        subscribedSymbols: string[];
        wsConnected: boolean;
        symbolCount: number;
    };
    forceResubscribeAll(): Promise<{
        ok: boolean;
        resubscribed: string[];
    }>;
    resetWebSocketStats(): void;
    getWebSocketStats(): {
        symbolTicks: {
            [k: string]: number;
        };
        lastTickTime: string;
        messagesReceived: number;
        ticksProcessed: number;
        ticksFiltered: number;
    };
    private getTodayDateET;
    private getMinuteOfDayET;
    private isAfterHoursNow;
}
