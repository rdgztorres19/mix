/**
 * config.ts — Configuration, types, and defaults for news-trader.
 */

export interface TradeConfig {
  positionSizeDollars: number;
  maxPositions: number;
  longTpPct: number;
  longSlPct: number;
  shortTpPct: number;
  shortSlPct: number;
  moderateTpPct: number;
  moderateSlPct: number;
  maxHoldMinutes: number;
  minPrice: number;
  maxPrice: number;
  maxNewsAgeMinutes: number;
  premarketStartET: string;
  marketOpenET: string;
  marketCloseET: string;
  forceCloseET: string;
  pollIntervalMs: number;       // position monitor interval
  premarketPollIntervalMs: number; // faster polling for manual TP/SL
  dryRun: boolean;
}

export const DEFAULT_CONFIG: TradeConfig = {
  positionSizeDollars: 1000,
  maxPositions: 5,
  longTpPct: 4,
  longSlPct: 2,
  shortTpPct: 4,
  shortSlPct: 2,
  moderateTpPct: 3,
  moderateSlPct: 2,
  maxHoldMinutes: 60,
  minPrice: 3,
  maxPrice: 100,
  maxNewsAgeMinutes: 5,
  premarketStartET: '07:00',
  marketOpenET: '09:30',
  marketCloseET: '15:30',
  forceCloseET: '15:55',
  pollIntervalMs: 30_000,
  premarketPollIntervalMs: 10_000,
  dryRun: false,
};

export interface NewsArticle {
  id: number;
  headline: string;
  created_at: string;
  updated_at?: string;
  symbols: string[];
  source: string;
  summary: string;
  url?: string;
}

export interface TradeSignal {
  symbol: string;
  direction: 'long' | 'short';
  headline: string;
  category: string;
  strength: 'STRONG' | 'MODERATE';
  tpPct: number;
  slPct: number;
  timestamp: string;
  newsId: number;
}

export interface ActivePosition {
  symbol: string;
  direction: 'long' | 'short';
  entryPrice: number;
  tpLevel: number;
  slLevel: number;
  orderId: string;
  bracketOrderId?: string;
  enteredAt: Date;
  headline: string;
  isPremarket: boolean;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  side: string;
  market_value: string;
  avg_entry_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
}

export interface AlpacaAccount {
  equity: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  status: string;
  symbol: string;
  side: string;
  type: string;
  filled_avg_price?: string;
  filled_qty?: string;
  legs?: AlpacaOrder[];
}

export function parseArgs(argv: string[]): Partial<TradeConfig> {
  const args = argv.slice(2);
  const config: Partial<TradeConfig> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        config.dryRun = true;
        break;
      case '--size':
        config.positionSizeDollars = parseFloat(args[++i]);
        break;
      case '--max-positions':
        config.maxPositions = parseInt(args[++i]);
        break;
      case '--tp':
        config.longTpPct = parseFloat(args[++i]);
        config.shortTpPct = config.longTpPct;
        break;
      case '--sl':
        config.longSlPct = parseFloat(args[++i]);
        config.shortSlPct = config.longSlPct;
        break;
    }
  }

  return config;
}

/** Get current ET time as "HH:MM" */
export function nowET(): string {
  return new Date().toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Parse "HH:MM" to minutes since midnight */
export function parseTimeMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Check if current ET time is within a range */
export function isWithinTimeRange(start: string, end: string): boolean {
  const now = parseTimeMinutes(nowET());
  return now >= parseTimeMinutes(start) && now <= parseTimeMinutes(end);
}

/** Check if we're in premarket hours */
export function isPremarket(config: TradeConfig): boolean {
  const now = parseTimeMinutes(nowET());
  return now >= parseTimeMinutes(config.premarketStartET) &&
         now < parseTimeMinutes(config.marketOpenET);
}

/** Check if we're in regular market hours */
export function isRegularHours(config: TradeConfig): boolean {
  const now = parseTimeMinutes(nowET());
  return now >= parseTimeMinutes(config.marketOpenET) &&
         now <= parseTimeMinutes(config.marketCloseET);
}

/** Check if it's time to force close */
export function isForceCloseTime(config: TradeConfig): boolean {
  const now = parseTimeMinutes(nowET());
  return now >= parseTimeMinutes(config.forceCloseET);
}
