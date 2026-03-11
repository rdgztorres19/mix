export interface RealTimeBar {
  symbol: string;
  timestamp: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
  tradeCount?: number;
}

export interface WebSocketConfig {
  enabled: boolean;
  reconnectIntervalMs: number;
  symbols: string[];
}

export interface IWebSocketDataSource {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(symbols: string[]): Promise<void>;
  unsubscribe(symbols: string[]): Promise<void>;
  isConnected(): boolean;
  getLastBarTime(symbol: string): number | null;
  onBar(callback: (bar: RealTimeBar) => void): void;
}