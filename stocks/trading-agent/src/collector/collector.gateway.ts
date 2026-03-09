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
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/collector',
})
export class CollectorGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CollectorGateway.name);

  @WebSocketServer()
  server!: Server;

  afterInit(): void {
    this.logger.log('CollectorGateway initialized (Socket.IO /collector)');
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * Emit a candle update to all connected clients.
   */
  emitCandleUpdate(row: CandleRow): void {
    const payload: CandleUpdatePayload = {
      symbol: row.symbol,
      date: row.date,
      candle: {
        time: Math.floor(new Date(`${row.date}T${row.candle_time_et}:00`).getTime() / 1000),
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
    };
    this.server.emit('candle:update', payload);
  }

  /**
   * Emit a live (in-progress) candle tick so the UI chart updates in real time.
   */
  emitCandleLive(symbol: string, candle: CollectorCandle): void {
    const { date } = timestampToET(candle.t);
    const payload: CandleUpdatePayload = {
      symbol,
      date,
      candle: {
        time: Math.floor(candle.t / 1000),
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
    };
    this.server.emit('candle:live', payload);
  }

  /**
   * Emit updated list of active symbols.
   */
  emitSymbolsUpdate(symbols: string[]): void {
    this.server.emit('symbols:update', { symbols });
  }
}
