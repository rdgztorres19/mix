import { OnModuleInit } from '@nestjs/common';
import { Estrategia } from './knowledge-chunks';
export interface RagResult {
    chunk_id: string;
    text: string;
    estrategia: Estrategia;
    sesiones: string[];
    tipo: string;
    score: number;
}
export declare class RagService implements OnModuleInit {
    private readonly logger;
    private qdrant;
    private embeddings;
    private collection;
    onModuleInit(): void;
    searchByStrategy(query: string, estrategia: Estrategia, limit?: number): Promise<RagResult[]>;
    searchGeneral(query: string, limit?: number): Promise<RagResult[]>;
    searchBySession(query: string, sesion: string, limit?: number): Promise<RagResult[]>;
    formatResultsForLLM(results: RagResult[]): string;
}
