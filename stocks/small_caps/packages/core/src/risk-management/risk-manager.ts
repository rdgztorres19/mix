import type { StrategyLevels, PositionSizing } from '@small-caps/shared';

export interface RiskValidationResult {
  passed: boolean;
  warnings: string[];
}

export class RiskManager {
  private readonly minRrRatio = 2;

  validate(
    levels: StrategyLevels,
    sizing: PositionSizing,
    accountSize: number,
  ): RiskValidationResult {
    const warnings: string[] = [];

    if (sizing.rrRatio < this.minRrRatio) {
      warnings.push(`R/R ratio ${sizing.rrRatio.toFixed(1)}:1 — below 2:1 minimum, consider skipping`);
    }

    const perShareRisk = levels.entry - levels.stop;
    if (perShareRisk < 0.05) {
      warnings.push('Stop too tight: per-share risk < $0.05');
    }

    const actualRisk = sizing.shareSize * sizing.perShareRisk;
    const maxRisk = accountSize * 0.02;
    if (actualRisk > maxRisk * 1.01) {
      warnings.push(`Position exceeds 2% max risk: $${actualRisk.toFixed(0)} > $${maxRisk.toFixed(0)}`);
    }

    return { passed: warnings.length === 0, warnings };
  }
}
