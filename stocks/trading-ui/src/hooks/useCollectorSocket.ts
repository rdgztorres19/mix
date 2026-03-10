import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export interface CandleUpdatePayload {
  symbol: string;
  date: string;
  candle: {
    time: number; // unix seconds (ET-based)
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };
  indicators: {
    vwap: number;
    ema9: number;
    ema20: number;
    atr: number;
    high_of_day: number;
    low_of_day: number;
  };
}

export interface SymbolsUpdatePayload {
  symbols: string[];
}

export interface PredictSignalPayload {
  symbol: string;
  date: string;
  time: string;
  prob: number;
  threshold: number;
  tradeable: boolean;
  close: number;
}

export interface TradeEntryPayload {
  symbol: string;
  date: string;
  time: string;
  price: number;
  qty: number;
  dollarAmount: number;
  orderId: string;
}

export interface TradeExitPayload {
  symbol: string;
  date: string;
  time: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  candlesHeld: number;
}

const BACKEND_URL = 'http://localhost:3033/collector';

/**
 * Hook that connects to the collector Socket.IO namespace and filters
 * candle:update events for the given symbol + date.
 */
export function useCollectorSocket(
  symbol: string | null,
  date: string | null,
  onCandle: (payload: CandleUpdatePayload) => void,
  onSymbols?: (symbols: string[]) => void,
  onPredictSignal?: (payload: PredictSignalPayload) => void,
  onTradeEntry?: (payload: TradeEntryPayload) => void,
  onTradeExit?: (payload: TradeExitPayload) => void,
) {
  const socketRef = useRef<Socket | null>(null);
  const onCandleRef = useRef(onCandle);
  const onSymbolsRef = useRef(onSymbols);
  const onPredictRef = useRef(onPredictSignal);
  const onEntryRef = useRef(onTradeEntry);
  const onExitRef = useRef(onTradeExit);
  onCandleRef.current = onCandle;
  onSymbolsRef.current = onSymbols;
  onPredictRef.current = onPredictSignal;
  onEntryRef.current = onTradeEntry;
  onExitRef.current = onTradeExit;

  const [activeSymbols, setActiveSymbols] = useState<string[]>([]);

  useEffect(() => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('candle:update', (payload: CandleUpdatePayload) => {
      // Filter: only forward if matches the current symbol + date
      if (
        symbol &&
        date &&
        payload.symbol === symbol &&
        payload.date === date
      ) {
        onCandleRef.current(payload);
      }
    });

    socket.on('candle:live', (payload: CandleUpdatePayload) => {
      if (
        symbol &&
        date &&
        payload.symbol === symbol &&
        payload.date === date
      ) {
        onCandleRef.current(payload);
      }
    });

    socket.on('symbols:update', (payload: SymbolsUpdatePayload) => {
      setActiveSymbols(payload.symbols);
      onSymbolsRef.current?.(payload.symbols);
    });

    // Auto-predict signals (all symbols, no filter)
    socket.on('predict:signal', (payload: PredictSignalPayload) => {
      onPredictRef.current?.(payload);
    });

    socket.on('trade:entry', (payload: TradeEntryPayload) => {
      onEntryRef.current?.(payload);
    });

    socket.on('trade:exit', (payload: TradeExitPayload) => {
      onExitRef.current?.(payload);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  // Re-connect when symbol/date changes so filter is up to date
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, date]);

  return { activeSymbols };
}
