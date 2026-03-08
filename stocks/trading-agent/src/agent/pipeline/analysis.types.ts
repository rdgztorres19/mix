/**
 * Shared types for the analysis pipeline.
 * Single place for request/response shapes.
 */

export interface AnalyzeRequest {
  ticker: string;
  account_size?: number;
  timeframe?: '1m' | '5m';
  cutoff_ms?: number;
  /** When true, uses deterministic pipeline. ~2-3s for early exits, no LLM. */
  fast?: boolean;
}

export interface AnalyzeResponse {
  ticker: string;
  decision: 'PREPARAR_ENTRADA' | 'MONITOREAR' | 'NO_OPERAR';
  momento_analisis_et: string | null;
  estrategia: string | null;
  estrategia_mas_probable: string | null;
  esperar_para_validar: string | null;
  entry: number | null;
  stop: number | null;
  target_1: number | null;
  target_2: number | null;
  share_size: number | null;
  riesgo_total: number | null;
  ratio_rr: number | null;
  sesion: string;
  justificacion: string;
  alertas: string[];
  rag_chunks_usados: number;
  tool_calls_made: number;
  raw_analysis: string;
}

/** Params for building an early-exit NO_OPERAR response (no LLM). */
export interface NoTradeResponseParams {
  tickerUpper: string;
  session: string;
  momentoEt: string;
  reason: string;
  alertas: string[];
  estrategia_mas_probable: string;
  esperar_para_validar: string;
  entry?: number | null;
  stop?: number | null;
  target_1?: number | null;
  target_2?: number | null;
  share_size?: number | null;
  riesgo_total?: number | null;
  ratio_rr?: number | null;
  estrategia?: string | null;
}
