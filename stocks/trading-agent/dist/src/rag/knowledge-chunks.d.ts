export type Sesion = 'open' | 'late_morning' | 'midday' | 'close' | 'all';
export type TipoChunk = 'entrada' | 'salida' | 'caracteristicas' | 'riesgo' | 'psicologia' | 'scanner' | 'general';
export type Estrategia = 'BULL_FLAG' | 'ABCD' | 'ORB' | 'VWAP_REVERSAL' | 'VWAP_FALSE_BREAKOUT' | 'VWAP_MA_TREND' | 'FALLEN_ANGEL' | 'GENERAL' | 'RISK_MANAGEMENT' | 'STOCK_SELECTION' | 'LEVEL2';
export interface KnowledgeChunk {
    id: string;
    text: string;
    estrategia: Estrategia;
    sesiones: Sesion[];
    tipo: TipoChunk;
}
export declare const KNOWLEDGE_CHUNKS: KnowledgeChunk[];
