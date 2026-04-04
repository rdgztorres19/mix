import { create } from 'zustand';
import { simulatorApi, type SimulationState } from '../api/backend';

interface SimulatorStore {
  symbol: string;
  date: string;
  currentIdx: number;
  maxIdx: number;
  playing: boolean;
  speed: number; // ms per candle
  state: SimulationState | null;
  loading: boolean;
  setSymbol: (symbol: string) => void;
  setDate: (date: string) => void;
  setSpeed: (speed: number) => void;
  fetchState: (idx?: number) => Promise<void>;
  stepForward: () => void;
  stepBackward: () => void;
  togglePlay: () => void;
  seekTo: (idx: number) => void;
}

export const useSimulatorStore = create<SimulatorStore>((set, get) => ({
  symbol: '',
  date: '',
  currentIdx: 0,
  maxIdx: 0,
  playing: false,
  speed: 500,
  state: null,
  loading: false,

  setSymbol: (symbol: string) => set({ symbol }),
  setDate: (date: string) => set({ date }),
  setSpeed: (speed: number) => set({ speed }),

  fetchState: async (idx?: number) => {
    const { symbol, date, currentIdx } = get();
    if (!symbol || !date) return;
    const targetIdx = idx ?? currentIdx;
    set({ loading: true });
    try {
      const state = await simulatorApi.getState(symbol, date, targetIdx);
      set({ state, currentIdx: state.candleIdx, maxIdx: state.maxIdx, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  stepForward: () => {
    const { currentIdx, maxIdx } = get();
    if (currentIdx < maxIdx) {
      const newIdx = currentIdx + 1;
      set({ currentIdx: newIdx });
      get().fetchState(newIdx);
    }
  },

  stepBackward: () => {
    const { currentIdx } = get();
    if (currentIdx > 0) {
      const newIdx = currentIdx - 1;
      set({ currentIdx: newIdx });
      get().fetchState(newIdx);
    }
  },

  togglePlay: () => set((s) => ({ playing: !s.playing })),

  seekTo: (idx: number) => {
    set({ currentIdx: idx });
    get().fetchState(idx);
  },
}));
