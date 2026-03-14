import { ChatOpenAI } from '@langchain/openai';
import { RagService } from '../../rag/rag.service';
import { ScannerService } from '../../scanner/scanner.service';
import { AnalysisLogService } from '../../analysis-log/analysis-log.service';
import { NewsCacheService } from '../../cache/news-cache.service';
import type { AnalyzeRequest, AnalyzeResponse } from './analysis.types';
import { AnalysisResponseBuilder } from './analysis-response.builder';
export declare class FastPipeline {
    private readonly scannerService;
    private readonly newsCache;
    private readonly ragService;
    private readonly analysisLog;
    private readonly responseBuilder;
    private readonly llm;
    private readonly logger;
    constructor(scannerService: ScannerService, newsCache: NewsCacheService, ragService: RagService, analysisLog: AnalysisLogService, responseBuilder: AnalysisResponseBuilder, llm: ChatOpenAI);
    run(req: AnalyzeRequest): Promise<AnalyzeResponse>;
    private getSession;
    private formatMomentoEt;
    private resolveCatalyst;
    private applyRules;
    private fetchRag;
    private earlyExitNoTrade;
    private runLlmAndRespond;
}
