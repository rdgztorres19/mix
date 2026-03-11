import { CollectorService } from './collector.service';
export declare class CollectorCron {
    private readonly collector;
    private readonly logger;
    constructor(collector: CollectorService);
    runDailyScan(): Promise<void>;
    runPeriodicScan(): Promise<void>;
    runMomoRefresh(): Promise<void>;
}
