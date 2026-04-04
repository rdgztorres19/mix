import type { PredictionCategory } from '@small-caps/shared';

export interface PredictPayload {
  candles: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  target_idx: number;
  candle_times_et: string[];
  candle_idx_arr: number[];
  atr: number;
  high_of_day: number;
  low_of_day: number;
  pre_market_high: number;
  change_pct_at_candle: number;
  shares_outstanding: number;
  market_cap: number;
  gap_pct: number;
  premarket_volume: number;
}

export interface PythonPredictResult {
  tradeable: boolean;
  prob: number;
  threshold: number;
  ignored?: boolean;
  ignore_reason?: string;
}

export interface ModelConfig {
  key: string;
  category: PredictionCategory;
  label: string;
  threshold: number;
}

export const MODEL_CONFIG: ModelConfig[] = [
  // SHORT (2)
  { key: 'LightGBM_V2_momentum_bin_drop_2p0_30m', category: 'short', label: 'LGBM drop2p', threshold: 0.7 },
  { key: 'XGBoost_V2_momentum_bin_drop_4p0_30m',  category: 'short', label: 'XGB drop4p',  threshold: 0.7 },
  // LONG (2)
  { key: 'LightGBM_V4_orderflow_bin_rr10m_ge_2',  category: 'long',  label: 'LGBM rr2',    threshold: 0.7 },
  { key: 'XGBoost_V2_full_bin_rr10m_ge_2',        category: 'long',  label: 'XGB rr2',     threshold: 0.7 },
  // VOLATILITY (2)
  { key: 'LightGBM_V3_bear_bin_vol_exp_30m_3atr', category: 'volatility', label: 'LGBM 30m3atr', threshold: 0.7 },
  { key: 'LightGBM_V3_bear_bin_vol_exp_10m_2atr', category: 'volatility', label: 'LGBM 10m2atr', threshold: 0.7 },
];
