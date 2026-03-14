import { CollectorService } from './collector.service';
export declare class CollectorCron {
    private readonly collector;
    private readonly logger;
    constructor(collector: CollectorService);
    runTopGainersCron(): Promise<void>;
}
