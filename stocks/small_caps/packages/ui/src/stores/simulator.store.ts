import { create } from 'zustand';
import { simulatorApi, predictorApi, type SimulationState } from '@/api/backend';
import type { PredictionBundle } from '@small-caps/shared';

export const STRATEGY_SOURCES = ['All', 'Advanced Trading', 'Warrior Trading'] as const;
export type StrategySource = typeof STRATEGY_SOURCES[number];

const PREDICTIONS_LS_KEY = 'small-caps:predictions-enabled';

function readPredictionsEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PREDICTIONS_LS_KEY) === 'true';
  } catch {
    return false;
  }
}

interface SimulatorStore {
  symbol: string;
  date: string;
  currentIdx: number;
  maxIdx: number;
  playing: boolean;
  speed: number;
  source: StrategySource;
  state: SimulationState | null;
  loading: boolean;
  predictionsEnabled: boolean;
  predictions: PredictionBundle | null;
  predictionsLoading: boolean;
  setSymbol: (symbol: string) => void;
  setDate: (date: string) => void;
  setSpeed: (speed: number) => void;
  setSource: (source: StrategySource) => void;
  fetchState: (idx?: number) => Promise<void>;
  stepForward: () => void;
  stepBackward: () => void;
  togglePlay: () => void;
  seekTo: (idx: number) => void;
  togglePredictions: () => void;
  fetchPredictions: () => Promise<void>;
}

export const useSimulatorStore = create<SimulatorStore>((set, get) => ({
  symbol: '', date: '', currentIdx: 0, maxIdx: 0,
  playing: false, speed: 500, source: 'All', state: null, loading: false,
  predictionsEnabled: readPredictionsEnabled(),
  predictions: null,
  predictionsLoading: false,

  setSymbol: (symbol: string) => set({ symbol }),
  setDate: (date: string) => set({ date }),
  setSpeed: (speed: number) => set({ speed }),
  setSource: (source: StrategySource) => { set({ source }); get().fetchState(); },

  fetchState: async (idx?: number) => {
    const { symbol, date, currentIdx, source } = get();
    if (!symbol || !date) return;
    const targetIdx = idx ?? currentIdx;
    set({ loading: true });
    try {
      const state = await simulatorApi.getState(symbol, date, targetIdx, source === 'All' ? undefined : source);
      set({ state, currentIdx: state.candleIdx, maxIdx: state.maxIdx, loading: false });
      if (get().predictionsEnabled) get().fetchPredictions();
    } catch { set({ loading: false }); }
  },

  stepForward: () => {
    const { currentIdx, maxIdx } = get();
    if (currentIdx < maxIdx) { set({ currentIdx: currentIdx + 1 }); get().fetchState(currentIdx + 1); }
  },

  stepBackward: () => {
    const { currentIdx } = get();
    if (currentIdx > 0) { set({ currentIdx: currentIdx - 1 }); get().fetchState(currentIdx - 1); }
  },

  togglePlay: () => set((s) => ({ playing: !s.playing })),
  seekTo: (idx: number) => { set({ currentIdx: idx }); get().fetchState(idx); },

  togglePredictions: () => {
    const next = !get().predictionsEnabled;
    try { localStorage.setItem(PREDICTIONS_LS_KEY, String(next)); } catch { /* ignore */ }
    set({ predictionsEnabled: next });
    if (next) get().fetchPredictions();
    else set({ predictions: null });
  },

  fetchPredictions: async () => {
    const { symbol, date, currentIdx, predictionsEnabled } = get();
    if (!predictionsEnabled || !symbol || !date || currentIdx < 0) return;
    set({ predictionsLoading: true });
    try {
      const bundle = await predictorApi.getPredictions(symbol, date, currentIdx);
      set({ predictions: bundle, predictionsLoading: false });
    } catch (err) {
      console.error('predictions fetch failed', err);
      set({ predictionsLoading: false });
    }
  },
}));
