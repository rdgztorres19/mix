import type { StrategyLevels } from '../types';
import type { PositionSizing } from '../types';
export interface RiskValidationResult {
    passed: boolean;
    warnings: string[];
}
export declare class RiskManager {
    private readonly minRrRatio;
    validate(levels: StrategyLevels, sizing: PositionSizing, accountSize: number): RiskValidationResult;
}
