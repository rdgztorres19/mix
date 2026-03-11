/**
 * CollectorGateway: Socket.IO WebSocket gateway that pushes real-time
 * candle updates and symbol list changes to the trading UI.
 */

import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import type { CandleRow, CollectorCandle } from './indicator.calculator';
import { timestampToET } from './indicator.calculator';

export interface CandleUpdatePayload {
  symbol: string;
  date: string;
  candle: {
    time: number;  // unix seconds (for lightweight-charts)
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
  // Add original timestamp for debugging
  debug?: {
    originalTimestampMs?: number;
    etString?: string;
  };
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/collector',
})
export class CollectorGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CollectorGateway.name);
  private connectedClients = new Set<string>();

  @WebSocketServer()
  server!: Server;

  afterInit(): void {
    this.logger.log('CollectorGateway initialized (Socket.IO /collector)');
  }

  handleConnection(client: Socket): void {
    this.connectedClients.add(client.id);
    this.logger.log(`✅ Client connected: ${client.id} (Total: ${this.connectedClients.size})`);
  }

  handleDisconnect(client: Socket): void {
    this.connectedClients.delete(client.id);
    this.logger.log(`❌ Client disconnected: ${client.id} (Total: ${this.connectedClients.size})`);
  }

  /**
   * Emit a candle update to all connected clients.
   */
  emitCandleUpdate(row: CandleRow): void {
    if (this.connectedClients.size === 0) {
      this.logger.warn(`⚠️  No clients connected - skipping candle:update for ${row.symbol}`);
      return;
    }

    // Use original timestamp if available (from CandleBuilder), otherwise reconstruct
    let unixSeconds: number;
    if (row.original_timestamp_ms) {
      // Direct conversion from original unix milliseconds (most accurate)
      unixSeconds = Math.floor(row.original_timestamp_ms / 1000);
    } else {
      // Fallback: reconstruct from ET time string (less accurate due to timezone issues)
      const etTimeString = `${row.date} ${row.candle_time_et}:00`;
      const etDate = new Date(`${etTimeString} GMT-0500`); // Assume EST for now
      unixSeconds = Math.floor(etDate.getTime() / 1000);
      this.logger.warn(`⚠️  Using reconstructed timestamp for ${row.symbol} - may be inaccurate`);
    }

    const payload: CandleUpdatePayload = {
      symbol: row.symbol,
      date: row.date,
      candle: {
        time: unixSeconds,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      },
      indicators: {
        vwap: row.vwap,
        ema9: row.ema9,
        ema20: row.ema20,
        atr: row.atr,
        high_of_day: row.high_of_day,
        low_of_day: row.low_of_day,
      },
      debug: {
        originalTimestampMs: row.original_timestamp_ms,
        etString: `${row.date} ${row.candle_time_et}:00`,
      },
    };
    
    this.logger.log(`📊 Emitting candle:update → ${row.symbol} ${row.candle_time_et} close=${row.close.toFixed(3)} time=${unixSeconds} (orig=${row.original_timestamp_ms}) to ${this.connectedClients.size} clients`);
    this.server.emit('candle:update', payload);
  }

  /**
   * Emit a live (in-progress) candle tick so the UI chart updates in real time.
   */
  emitCandleLive(symbol: string, candle: CollectorCandle): void {
    if (this.connectedClients.size === 0) {
      return; // Skip live ticks if no clients (too noisy to log)
    }

    // Ensure timestamp is always in unix seconds for UI consistency 
    // candle.t should already be unix milliseconds from CandleBuilder
    const unixSeconds = Math.floor(candle.t / 1000);
    const { date } = timestampToET(candle.t);
    
    const payload: CandleUpdatePayload = {
      symbol,
      date,
      candle: {
        time: unixSeconds,
        open: candle.o,
        high: candle.h,
        low: candle.l,
        close: candle.c,
        volume: candle.v,
      },
      indicators: {
        vwap: 0,
        ema9: 0,
        ema20: 0,
        atr: 0,
        high_of_day: 0,
        low_of_day: 0,
      },
      debug: {
        originalTimestampMs: candle.t,
        etString: `live tick from ${symbol}`,
      },
    };
    
    this.logger.debug(`📈 Emitting candle:live → ${symbol} price=${candle.c.toFixed(3)} time=${unixSeconds} (ms=${candle.t})`);
    this.server.emit('candle:live', payload);
  }

  /**
   * Emit updated list of active symbols.
   */
  emitSymbolsUpdate(symbols: string[]): void {
    this.logger.log(`📋 Emitting symbols:update → ${symbols.length} symbols: [${symbols.join(', ')}] to ${this.connectedClients.size} clients`);
    this.server.emit('symbols:update', { symbols });
  }

  /**
   * Get debug info about connected clients.
   */
  getConnectionInfo() {
    return {
      connectedClients: this.connectedClients.size,
      clientIds: [...this.connectedClients],
      namespace: '/collector',
    };
  }

  /**
   * Emit an ML predict signal (every candle close when auto-predict is on).
   */
  emitPredictSignal(payload: {
    symbol: string;
    date: string;
    time: string;
    prob: number;
    threshold: number;
    tradeable: boolean;
    close: number;
  }): void {
    this.server.emit('predict:signal', payload);
  }

  /**
   * Emit a trade entry notification.
   */
  emitTradeEntry(payload: {
    symbol: string;
    date: string;
    time: string;
    price: number;
    qty: number;
    dollarAmount: number;
    orderId: string;
  }): void {
    this.server.emit('trade:entry', payload);
  }

  /**
   * Emit a trade exit notification.
   */
  emitTradeExit(payload: {
    symbol: string;
    date: string;
    time: string;
    entryPrice: number;
    exitPrice: number;
    qty: number;
    pnl: number;
    candlesHeld: number;
  }): void {
    this.server.emit('trade:exit', payload);
  }
}
