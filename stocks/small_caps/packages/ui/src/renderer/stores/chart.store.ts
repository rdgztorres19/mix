import { create } from 'zustand';
import { chartApi, type ChartData, type Candle, type IndicatorValues } from '../api/backend';

interface ChartStore {
  symbol: string;
  date: string;
  timeframe: '1m' | '5m';
  candles: Candle[];
  indicators: IndicatorValues[];
  news: any[];
  loading: boolean;
  setSymbol: (symbol: string) => void;
  setDate: (date: string) => void;
  setTimeframe: (tf: '1m' | '5m') => void;
  fetchCandles: () => Promise<void>;
  fetchNews: () => Promise<void>;
}

export const useChartStore = create<ChartStore>((set, get) => ({
  symbol: '',
  date: '',
  timeframe: '1m',
  candles: [],
  indicators: [],
  news: [],
  loading: false,

  setSymbol: (symbol: string) => set({ symbol }),
  setDate: (date: string) => set({ date }),
  setTimeframe: (tf: '1m' | '5m') => set({ timeframe: tf }),

  fetchCandles: async () => {
    const { symbol, date, timeframe } = get();
    if (!symbol || !date) return;
    set({ loading: true });
    try {
      const data = await chartApi.getCandles(symbol, date, timeframe);
      set({ candles: data.candles, indicators: data.indicators, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchNews: async () => {
    const { symbol, date } = get();
    if (!symbol || !date) return;
    try {
      const news = await chartApi.getNews(symbol, date);
      set({ news });
    } catch {}
  },
}));
