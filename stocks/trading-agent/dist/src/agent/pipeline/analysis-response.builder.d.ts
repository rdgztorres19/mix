import type { AnalyzeResponse, NoTradeResponseParams } from './analysis.types';
export declare class AnalysisResponseBuilder {
    private readonly logger;
    parse(raw: string, ticker: string, _accountSize: number): Omit<AnalyzeResponse, 'ticker' | 'momento_analisis_et' | 'rag_chunks_usados' | 'tool_calls_made' | 'raw_analysis'>;
    buildNoTrade(params: NoTradeResponseParams & {
        account_size: number;
        cutoff_ms?: number;
        tool_calls_made: number;
    }): AnalyzeResponse;
}
