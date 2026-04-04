import { create } from 'zustand';
import { screenerApi, type ScreenerSymbol } from '../api/backend';

interface ScreenerStore {
  date: string;
  dates: string[];
  results: ScreenerSymbol[];
  loading: boolean;
  error: string | null;
  setDate: (date: string) => void;
  fetchDates: () => Promise<void>;
  fetchResults: () => Promise<void>;
}

export const useScreenerStore = create<ScreenerStore>((set, get) => ({
  date: '',
  dates: [],
  results: [],
  loading: false,
  error: null,

  setDate: (date: string) => set({ date }),

  fetchDates: async () => {
    try {
      const dates = await screenerApi.getDates();
      set({ dates });
      if (dates.length > 0 && !get().date) {
        set({ date: dates[0] });
      }
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  fetchResults: async () => {
    const { date } = get();
    if (!date) return;
    set({ loading: true, error: null });
    try {
      const result = await screenerApi.getScreener(date);
      set({ results: result.symbols, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },
}));
