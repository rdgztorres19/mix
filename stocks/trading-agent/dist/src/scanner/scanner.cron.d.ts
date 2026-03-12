import { ScannerService, StockCandidate } from './scanner.service';
export declare class ScannerCron {
    private readonly scannerService;
    private readonly logger;
    private latestWatchlist;
    private lastRun;
    constructor(scannerService: ScannerService);
    runDailyScanner(): Promise<void>;
    runPreOpenRefresh(): Promise<void>;
    getLatestWatchlist(): {
        candidates: StockCandidate[];
        lastRun: Date | null;
    };
}
