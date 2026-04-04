import { create } from 'zustand';
import { chartApi, type Candle, type IndicatorValues, type StockProfile, type ChartLevels } from '@/api/backend';

interface ChartStore {
  symbol: string;
  date: string;
  timeframe: '1m' | '5m';
  candles: Candle[];
  indicators: IndicatorValues[];
  levels: ChartLevels | null;
  news: any[];
  profile: StockProfile | null;
  loading: boolean;
  setSymbol: (symbol: string) => void;
  setDate: (date: string) => void;
  setTimeframe: (tf: '1m' | '5m') => void;
  fetchCandles: () => Promise<void>;
  fetchNews: () => Promise<void>;
  fetchProfile: () => Promise<void>;
}

export const useChartStore = create<ChartStore>((set, get) => ({
  symbol: '', date: '', timeframe: '1m',
  candles: [], indicators: [], levels: null, news: [], profile: null, loading: false,

  setSymbol: (symbol: string) => set({ symbol }),
  setDate: (date: string) => set({ date }),
  setTimeframe: (tf: '1m' | '5m') => set({ timeframe: tf }),

  fetchCandles: async () => {
    const { symbol, date, timeframe } = get();
    if (!symbol || !date) return;
    set({ loading: true });
    try {
      const data = await chartApi.getCandles(symbol, date, timeframe);
      set({ candles: data.candles, indicators: data.indicators, levels: data.levels, loading: false });
    } catch { set({ loading: false }); }
  },

  fetchNews: async () => {
    const { symbol, date } = get();
    if (!symbol || !date) return;
    try { set({ news: await chartApi.getNews(symbol, date) }); } catch {}
  },

  fetchProfile: async () => {
    const { symbol } = get();
    if (!symbol) return;
    try { set({ profile: await chartApi.getProfile(symbol) }); } catch {}
  },
}));
