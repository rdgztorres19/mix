import type { SnapshotsResponse } from '../../alpaca/alpaca-screener.client';
import type { ScreenerRankRow } from '../../persistence/screener.repository';
export declare function rankTopGappers(snapshots: SnapshotsResponse, _sessionDate: string, prevCloseBySymbol: ReadonlyMap<string, number>, topN: number, minVolume: number): ScreenerRankRow[];
export declare function rankTopGainersSession(snapshots: SnapshotsResponse, _sessionDate: string, prevCloseBySymbol: ReadonlyMap<string, number>, topN: number, minVolume: number): ScreenerRankRow[];
export declare function rankTopGainersIntraday(snapshots: SnapshotsResponse, _sessionDate: string, prevCloseBySymbol: ReadonlyMap<string, number>, topN: number, minVolume: number): ScreenerRankRow[];
export declare function rankTopHighSession(snapshots: SnapshotsResponse, _sessionDate: string, prevCloseBySymbol: ReadonlyMap<string, number>, topN: number, minVolume: number): ScreenerRankRow[];
export declare function rankTopHighCurrent(snapshots: SnapshotsResponse, _sessionDate: string, prevCloseBySymbol: ReadonlyMap<string, number>, topN: number, minVolume: number): ScreenerRankRow[];
export declare function barsPrevCloseBeforeSession(bars: import('../../alpaca/alpaca-screener.client').AlpacaBar[], sessionDate: string): number | null;
