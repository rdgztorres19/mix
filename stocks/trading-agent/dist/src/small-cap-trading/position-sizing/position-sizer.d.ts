export declare class PositionSizer {
    private readonly minRiskPerShare;
    private readonly maxRiskPct;
    size(accountSize: number, entry: number, stop: number, target1: number): {
        shareSize: number;
        maxRisk: number;
        perShareRisk: number;
        rrRatio: number;
    };
}
