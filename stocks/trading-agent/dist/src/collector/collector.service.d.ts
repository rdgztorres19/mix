import { OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { MysqlTrainingRepository } from '../scanner/mysql/mysql-training.repository';
import { AlpacaDataSource } from '../scanner/datasource/alpaca-datasource';
import { ScannerService } from '../scanner/scanner.service';
import { MomoStreamService } from './momo-stream.service';
import { CollectorGateway } from './collector.gateway';
import { AutoTraderService } from '../trader/auto-trader.service';
import { CollectorCandle } from './indicator.calculator';
import { TopGainersSourceService, type TopGainerSource } from './top-gainers-source.service';
import { ScannedTrackerService } from './tracker/scanned-tracker.service';
export declare class CollectorService implements OnModuleInit {
    private readonly moduleRef;
    private readonly mysqlRepo;
    private readonly alpacaDataSource;
    private readonly scannerService;
    private readonly momoStream;
    private readonly gateway;
    private readonly topGainersSource;
    private readonly scannedTracker;
    private readonly autoTrader?;
    private readonly logger;
    private readonly symbols;
    private readonly activeSymbols;
    private readonly momoBase;
    private webSocketInit?;
    constructor(moduleRef: ModuleRef, mysqlRepo: MysqlTrainingRepository, alpacaDataSource: AlpacaDataSource, scannerService: ScannerService, momoStream: MomoStreamService, gateway: CollectorGateway, topGainersSource: TopGainersSourceService, scannedTracker: ScannedTrackerService, autoTrader?: AutoTraderService);
    onModuleInit(): Promise<void>;
    addSymbolToCollection(symbol: string, source?: string, skipPersist?: boolean): Promise<void>;
    private onLiveTick;
    onCandleClosed(symbol: string, candle: CollectorCandle): Promise<void>;
    resetActiveSymbols(): Promise<void>;
    runTopGainersCron(): Promise<void>;
    scanMomo(): Promise<string[]>;
    refreshAllFromMomo(): Promise<{
        skipped: boolean;
        reason?: string;
    }>;
    migrateToAlpacaIfAvailable(): Promise<void>;
    getSymbolsList(): string[];
    getActiveSymbolList(): string[];
    getDebugStatus(): {
        activeSymbols: string[];
        subscribedSymbols: string[];
        symbols: string[];
        wsConnected: boolean;
        symbolCount: number;
    };
    reloadMissingSymbolsFromDb(): Promise<number>;
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
    private _syncSymbolDateCore;
    syncSymbolDate(symbol: string, dateStr: string): Promise<{
        ok: boolean;
        rows: number;
        error?: string;
    }>;
    syncTodayFromSource(source: TopGainerSource): Promise<{
        ok: boolean;
        symbols: number;
        totalRows: number;
        skipped?: boolean;
        reason?: string;
    }>;
    syncDate(dateStr: string): Promise<{
        ok: boolean;
        symbols: number;
        totalRows: number;
        errors: string[];
    }>;
    private prevTradingDay;
}
