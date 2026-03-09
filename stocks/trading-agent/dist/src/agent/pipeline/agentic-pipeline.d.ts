import { ChatOpenAI } from '@langchain/openai';
import { RagService } from '../../rag/rag.service';
import { ScannerService } from '../../scanner/scanner.service';
import { AnalysisLogService } from '../../analysis-log/analysis-log.service';
import type { AnalyzeRequest, AnalyzeResponse } from './analysis.types';
import { AnalysisResponseBuilder } from './analysis-response.builder';
export declare class AgenticPipeline {
    private readonly ragService;
    private readonly scannerService;
    private readonly analysisLog;
    private readonly responseBuilder;
    private readonly llm;
    private readonly logger;
    constructor(ragService: RagService, scannerService: ScannerService, analysisLog: AnalysisLogService, responseBuilder: AnalysisResponseBuilder, llm: ChatOpenAI);
    run(req: AnalyzeRequest): Promise<AnalyzeResponse>;
    private serializeMessages;
}
