// @ts-nocheck
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ScannerService, StockSnapshot } from '../../scanner/scanner.service';

// 0 = send all candles from the history window (default); any positive number caps it
const TOOL_CANDLES = parseInt(process.env.TOOL_CANDLES_SHOWN ?? '0', 10);
const TRADING_DAYS_HISTORY = parseInt(process.env.TRADING_DAYS_HISTORY ?? '2', 10);

export function createScannerTool(scannerService: ScannerService, cutoffMs?: number, timeframe: '1m' | '5m' = '5m'): any {
  return tool(
    async ({ ticker }) => {
      try {
        const snap = await scannerService.getStockSnapshot(ticker.toUpperCase(), cutoffMs, timeframe);
        return formatStockSnapshotForLLM(snap, ticker.toUpperCase(), timeframe, cutoffMs);
      } catch (err) {
        return `Error fetching stock data for ${ticker}: ${err.message}`;
      }
    },
    {
      name: 'get_stock_data',
      description:
        'Fetches real-time stock data from momoscreener.com for a given ticker. ' +
        'Returns: current price, VWAP, EMA9, EMA20, relative volume, ATR, ' +
        'high/low of day, pre-market high, candles (' + timeframe + '), and current trading session. ' +
        'Use this to understand where the stock is relative to key technical levels.',
      schema: z.object({
        ticker: z.string().describe('Stock ticker symbol, e.g. NVDA, TSLA, AAPL'),
      }),
    },
  );
}

/** Exported for pipeline fast path — computes session from ET time string. */
export function getSession(etTime: string): string {
  const [h, m] = etTime.split(':').map(Number);
  const totalMinutes = h * 60 + m;

  if (totalMinutes < 9 * 60 + 30) return 'PRE_MARKET';
  if (totalMinutes < 10 * 60 + 30) return 'THE_OPEN (9:30-10:30am)';
  if (totalMinutes < 12 * 60) return 'LATE_MORNING (10:30am-12pm)';
  if (totalMinutes < 15 * 60) return 'MIDDAY (12pm-3pm)';
  if (totalMinutes < 16 * 60) return 'THE_CLOSE (3pm-4pm)';
  return 'AFTER_HOURS';
}

/** Exported for pipeline fast path — formats StockSnapshot as LLM-ready string. */
export function formatStockSnapshotForLLM(
  snap: StockSnapshot,
  ticker: string,
  timeframe: '1m' | '5m',
  cutoffMs?: number,
): string {
  const refDate = cutoffMs ? new Date(cutoffMs) : new Date();
  const etTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(refDate);
  const session = getSession(etTime);
  const priceVsVwap =
    snap.vwap
      ? snap.price > snap.vwap
        ? `ABOVE VWAP (+${((snap.price - snap.vwap) / snap.vwap * 100).toFixed(2)}%)`
        : `BELOW VWAP (-${((snap.vwap - snap.price) / snap.vwap * 100).toFixed(2)}%)`
      : 'VWAP unavailable';
  const ema9Relation =
    snap.ema9 ? (snap.price > snap.ema9 ? `above EMA9 (${snap.ema9.toFixed(2)})` : `below EMA9 (${snap.ema9.toFixed(2)})`) : 'EMA9 unavailable';
  const ema20Relation =
    snap.ema20 ? (snap.price > snap.ema20 ? `above EMA20 (${snap.ema20.toFixed(2)})` : `below EMA20 (${snap.ema20.toFixed(2)})`) : 'EMA20 unavailable';
  const candlesForInterval = timeframe === '1m' ? snap.candles_1min : snap.candles_5min;
  const lastCandles = TOOL_CANDLES > 0 ? candlesForInterval.slice(-TOOL_CANDLES) : candlesForInterval;
  const candleSummary = lastCandles
    .map((c) => {
      const timeStr = new Date(c.t).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      return `[${timeStr} ${c.o > c.c ? 'RED' : 'GRN'} O:${c.o.toFixed(2)} H:${c.h.toFixed(2)} L:${c.l.toFixed(2)} C:${c.c.toFixed(2)} V:${(c.v / 1000).toFixed(0)}K]`;
    })
    .join('\n');
  const simLabel = cutoffMs ? ' [SIMULATION]' : '';
  return `STOCK DATA: ${ticker}${simLabel}
Time (ET): ${etTime} | Session: ${session}
─────────────────────────────────
Price: $${snap.price.toFixed(2)}
Change Today: ${(snap.change_pct * 100).toFixed(2)}%
High of Day: $${snap.high_of_day?.toFixed(2) || 'N/A'} | Low of Day: $${snap.low_of_day?.toFixed(2) || 'N/A'}
VWAP: ${snap.vwap ? '$' + snap.vwap.toFixed(2) : 'N/A'} → Price is ${priceVsVwap}
EMA9: $${snap.ema9?.toFixed(2) || 'N/A'} → Price ${ema9Relation}
EMA20: $${snap.ema20?.toFixed(2) || 'N/A'} → Price ${ema20Relation}
Pre-market High: ${snap.pre_market_high ? '$' + snap.pre_market_high.toFixed(2) : 'N/A'}
Volume: ${(snap.volume / 1e6).toFixed(2)}M | Avg: ${(snap.avg_volume / 1e6).toFixed(2)}M | Rel Vol: ${snap.relative_volume.toFixed(1)}x
ATR (14d): $${snap.atr.toFixed(2)}
─────────────────────────────────
${timeframe} candles (${lastCandles.length} candles):
${candleSummary || 'No intraday data available'}`;
}
