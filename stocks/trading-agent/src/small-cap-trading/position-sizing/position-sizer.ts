/**
 * Position sizing: 2% max risk rule.
 * shareSize = floor(maxRisk / perShareRisk), perShareRisk = max(entry - stop, 0.05)
 */
export class PositionSizer {
  private readonly minRiskPerShare = 0.05;
  private readonly maxRiskPct = 0.02;

  size(
    accountSize: number,
    entry: number,
    stop: number,
    target1: number,
  ): { shareSize: number; maxRisk: number; perShareRisk: number; rrRatio: number } {
    const maxRisk = accountSize * this.maxRiskPct;
    const perShareRisk = Math.max(entry - stop, this.minRiskPerShare);
    const shareSize = Math.floor(maxRisk / perShareRisk);
    const rrRatio = (target1 - entry) / perShareRisk;
    return {
      shareSize,
      maxRisk,
      perShareRisk,
      rrRatio,
    };
  }
}
