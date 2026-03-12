import { ScannerService, StockSnapshot } from '../../scanner/scanner.service';
export declare function createScannerTool(scannerService: ScannerService, cutoffMs?: number, timeframe?: '1m' | '5m'): any;
export declare function getSession(etTime: string): string;
export declare function formatStockSnapshotForLLM(snap: StockSnapshot, ticker: string, timeframe: '1m' | '5m', cutoffMs?: number): string;
