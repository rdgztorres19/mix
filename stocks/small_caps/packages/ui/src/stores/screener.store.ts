import { create } from 'zustand';
import { screenerApi, type ScreenerSymbol } from '@/api/backend';

// ── Filter types ──

export interface ScreenerFilters {
  priceMin: number | null;
  priceMax: number | null;
  gapPctMin: number | null;
  volumeMin: number | null;
  changePctMin: number | null;
}

export interface FilterPreset {
  name: string;
  source: string;
  filters: ScreenerFilters;
}

const EMPTY_FILTERS: ScreenerFilters = {
  priceMin: null, priceMax: null, gapPctMin: null, volumeMin: null, changePctMin: null,
};

export const FILTER_PRESETS: FilterPreset[] = [
  {
    name: 'All',
    source: '',
    filters: { ...EMPTY_FILTERS },
  },
  {
    name: 'Advanced Trading',
    source: 'Advanced Trading',
    filters: {
      priceMin: 1,
      priceMax: 50,
      gapPctMin: 2,
      volumeMin: 500_000,
      changePctMin: 2,
    },
  },
  {
    name: 'Warrior Trading',
    source: 'Warrior Trading',
    filters: {
      priceMin: 2,
      priceMax: 20,
      gapPctMin: 10,
      volumeMin: null,
      changePctMin: 10,
    },
  },
];

// ── Sort types ──

export type SortField = 'gapPct' | 'changePct' | 'hodPct' | 'morningPct' | 'volume' | 'close';
export type SortOrder = 'asc' | 'desc';

// ── Store ──

interface ScreenerStore {
  date: string;
  results: ScreenerSymbol[];
  filters: ScreenerFilters;
  activePreset: string;
  sortField: SortField;
  sortOrder: SortOrder;
  loading: boolean;
  error: string | null;
  initialized: boolean;
  setDate: (date: string) => void;
  setFilter: <K extends keyof ScreenerFilters>(key: K, value: ScreenerFilters[K]) => void;
  applyPreset: (name: string) => void;
  clearFilters: () => void;
  setSort: (field: SortField) => void;
  init: () => Promise<void>;
  fetchResults: () => Promise<void>;
  getFilteredResults: () => ScreenerSymbol[];
}

export const useScreenerStore = create<ScreenerStore>((set, get) => ({
  date: localStorage.getItem('screener-last-date') || '',
  results: [],
  filters: { ...FILTER_PRESETS[1].filters },
  activePreset: 'Advanced Trading',
  sortField: 'gapPct',
  sortOrder: 'desc',
  loading: false,
  error: null,
  initialized: false,

  setDate: (date: string) => {
    localStorage.setItem('screener-last-date', date);
    set({ date });
  },

  setFilter: (key, value) => {
    set((s) => ({
      filters: { ...s.filters, [key]: value },
      activePreset: 'Custom',
    }));
  },

  applyPreset: (name: string) => {
    const preset = FILTER_PRESETS.find((p) => p.name === name);
    if (preset) {
      set({ filters: { ...preset.filters }, activePreset: name });
    }
  },

  clearFilters: () => {
    set({ filters: { ...EMPTY_FILTERS }, activePreset: 'All' });
  },

  /** Toggle sort: click same field → flip order, click different field → desc */
  setSort: (field: SortField) => {
    const { sortField, sortOrder } = get();
    if (field === sortField) {
      set({ sortOrder: sortOrder === 'desc' ? 'asc' : 'desc' });
    } else {
      set({ sortField: field, sortOrder: 'desc' });
    }
  },

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });
    try {
      if (get().date) {
        get().fetchResults();
      } else {
        const dates = await screenerApi.getDates();
        if (dates.length > 0) {
          get().setDate(dates[0]);
          get().fetchResults();
        }
      }
    } catch {}
  },

  fetchResults: async () => {
    const { date } = get();
    if (!date) return;
    set({ loading: true, error: null, results: [] });
    try {
      const result = await screenerApi.getStocks(date);
      set({ results: result.symbols, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  getFilteredResults: () => {
    const { results, filters, sortField, sortOrder } = get();

    // Filter
    const filtered = results.filter((s) => {
      const price = s.close || s.open;
      if (filters.priceMin != null && price < filters.priceMin) return false;
      if (filters.priceMax != null && price > filters.priceMax) return false;
      if (filters.gapPctMin != null && Math.abs(s.gapPct) < filters.gapPctMin) return false;
      if (filters.volumeMin != null && s.volume < filters.volumeMin) return false;
      if (filters.changePctMin != null && Math.abs(s.changePct) < filters.changePctMin) return false;
      return true;
    });

    // Sort
    const getValue = (s: ScreenerSymbol): number => {
      switch (sortField) {
        case 'gapPct': return s.gapPct;
        case 'changePct': return s.changePct;
        case 'hodPct': return s.previousClose > 0 ? ((s.high - s.previousClose) / s.previousClose) * 100 : 0;
        case 'morningPct': return s.morningPct ?? 0;
        case 'volume': return s.volume;
        case 'close': return s.close;
        default: return s.gapPct;
      }
    };

    const mult = sortOrder === 'desc' ? -1 : 1;
    return filtered.sort((a, b) => mult * (getValue(a) - getValue(b)));
  },
}));
