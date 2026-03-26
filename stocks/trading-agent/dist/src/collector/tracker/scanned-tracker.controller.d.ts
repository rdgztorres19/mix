import { ScannedTrackerService, ScannedSymbolData } from './scanned-tracker.service';
export declare class ScannedTrackerController {
    private readonly trackerService;
    constructor(trackerService: ScannedTrackerService);
    getTrackedSymbolsToday(): ScannedSymbolData[];
}
