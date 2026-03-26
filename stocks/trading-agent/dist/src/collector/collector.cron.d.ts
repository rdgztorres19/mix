import { OnModuleInit } from '@nestjs/common';
import { CollectorService } from './collector.service';
export declare class CollectorCron implements OnModuleInit {
    private readonly collector;
    private readonly logger;
    constructor(collector: CollectorService);
    onModuleInit(): Promise<void>;
    runTopGainersCron(): Promise<void>;
}
