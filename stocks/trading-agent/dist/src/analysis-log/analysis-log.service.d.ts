import { OnModuleInit } from '@nestjs/common';
export interface AnalysisLogEntry {
    id: number;
    ticker: string;
    account_size: number;
    cutoff_ms: number | null;
    request_prompt: string;
    messages_json: string;
    response_json: string;
    raw_analysis: string;
    tool_calls_count: number;
    rag_chunks_used: number;
    duration_ms: number;
    error_text: string | null;
    created_at: Date;
}
export interface AnalysisLogInsert {
    ticker: string;
    account_size: number;
    cutoff_ms: number | null;
    request_prompt: string;
    messages_json: string;
    response_json: string;
    raw_analysis: string;
    tool_calls_count: number;
    rag_chunks_used: number;
    duration_ms: number;
    error_text?: string | null;
}
export declare class AnalysisLogService implements OnModuleInit {
    private readonly logger;
    private pool;
    onModuleInit(): Promise<void>;
    insert(entry: AnalysisLogInsert): Promise<number | null>;
    list(limit?: number, ticker?: string): Promise<AnalysisLogEntry[]>;
    getById(id: number): Promise<AnalysisLogEntry | null>;
}
