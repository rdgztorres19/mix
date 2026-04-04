import axios from 'axios';
import type { PredictionBundle } from '@small-caps/shared';

const api = axios.create({
  baseURL: 'http://localhost:3001/api',
  timeout: 30000,
});

export interface ScreenerResult {
  date: string;
  symbols: ScreenerSymbol[];
}

export interface ScreenerSymbol {
  symbol: string;
  rank: number;
  gapPct: number;
  changePct: number;
  morningPct: number;
  volume: number;
  rankTypes: string[];
  previousClose: number;
  open: number;
  close: number;
  high: number;
  low: number;
}

export interface ChartLevels {
  prevClose: number | null;
  preMarketHigh: number | null;
  preMarketLow: number | null;
}

export interface ChartData {
  candles: Candle[];
  indicators: IndicatorValues[];
  levels: ChartLevels;
}

export interface Candle {
  o: number; h: number; l: number; c: number; v: number; t: number;
}

export interface IndicatorValues {
  vwap: number | null;
  ema9: number | null;
  ema20: number | null;
  sma50: number | null;
  sma200: number | null;
  atr: number;
  rsi: number | null;
}

export interface StockProfile {
  symbol: string;
  shares_outstanding: number | null;
  market_cap: number | null;
}

export interface SimulationState {
  symbol: string;
  date: string;
  candleIdx: number;
  maxIdx: number;
  candles: Candle[];
  indicators: IndicatorValues[];
  activeStrategies: any[];
  candlestickPatterns: any[];
  supportResistanceLevels: any[];
  rulesResult: any;
}

export const screenerApi = {
  getDates: () => api.get<string[]>('/screener/dates').then((r) => r.data),
  getStocks: (date: string) => api.get<ScreenerResult>(`/screener/stocks/${date}`).then((r) => r.data),
  computeScreener: (date: string) => api.get<ScreenerResult>(`/screener/compute/${date}`).then((r) => r.data),
};

export const chartApi = {
  getCandles: (symbol: string, date: string, tf: '1m' | '5m' = '1m') =>
    api.get<ChartData>(`/chart/${symbol}/${date}?tf=${tf}`).then((r) => r.data),
  getNews: (symbol: string, date: string) =>
    api.get(`/chart/${symbol}/${date}/news`).then((r) => r.data),
  getProfile: (symbol: string) =>
    api.get<StockProfile | null>(`/chart/profile/${symbol}`).then((r) => r.data),
};

export const simulatorApi = {
  getState: (symbol: string, date: string, candleIdx: number, source?: string) =>
    api.get<SimulationState>(`/simulator/${symbol}/${date}/${candleIdx}`, {
      params: source ? { source } : undefined,
    }).then((r) => r.data),
};

export const predictorApi = {
  getPredictions: (symbol: string, date: string, candleIdx: number) =>
    api.get<PredictionBundle>(`/predictor/${symbol}/${date}/${candleIdx}`).then((r) => r.data),
};
