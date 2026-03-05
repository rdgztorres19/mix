export interface Candle {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: number; // ms timestamp
}

export interface StockSnapshot {
  ticker: string;
  price: number;
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  volume: number;
  avg_volume: number;
  relative_volume: number;
  change_pct: number;
  pre_market_high: number | null;
  candles_1min: Candle[];
  candles_5min: Candle[];
  atr: number;
  high_of_day: number;
  low_of_day: number;
}

export interface NewsItem {
  title: string;
  publisher: string;
  published_at: string;
  url: string;
  age_minutes: number;
}

export interface CatalystAnalysis {
  ticker: string;
  headlines: NewsItem[];
  catalyst_strength: 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
  catalyst_type: string;
  justifies_move: boolean;
  is_dilutive: boolean;
  confidence: number;
  summary: string;
  trade_implication: string;
}

export interface MomoStock {
  symbol: string;
  price: number;
  change: number;
  change5m: number;
  volume: number;
  float: number | null;
  headline: string;
  headline_source: string;
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
