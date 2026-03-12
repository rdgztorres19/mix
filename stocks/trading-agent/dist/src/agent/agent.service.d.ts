import type { AnalyzeRequest, AnalyzeResponse } from './pipeline';
import { AgenticPipeline } from './pipeline/agentic-pipeline';
import { FastPipeline } from './pipeline/fast-pipeline';
export type { AnalyzeRequest, AnalyzeResponse } from './pipeline';
export declare class AgentService {
    private readonly agenticPipeline;
    private readonly fastPipeline;
    private readonly logger;
    constructor(agenticPipeline: AgenticPipeline, fastPipeline: FastPipeline);
    analyze(req: AnalyzeRequest): Promise<AnalyzeResponse>;
}
