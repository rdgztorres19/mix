export type PredictionCategory = 'short' | 'long' | 'volatility';

export interface ModelPrediction {
  modelKey: string;
  category: PredictionCategory;
  label: string;
  prob: number;
  tradeable: boolean;
  threshold: number;
  error?: string;
}

export interface PredictionBundle {
  symbol: string;
  date: string;
  candleIdx: number;
  timestamp: number;
  short: ModelPrediction[];
  long: ModelPrediction[];
  volatility: ModelPrediction[];
}
