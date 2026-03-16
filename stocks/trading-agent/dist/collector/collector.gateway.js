/**
 * CollectorGateway: Socket.IO WebSocket gateway that pushes real-time
 * candle updates and symbol list changes to the trading UI.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CollectorGateway", {
    enumerable: true,
    get: function() {
        return CollectorGateway;
    }
});
const _websockets = require("@nestjs/websockets");
const _common = require("@nestjs/common");
const _socketio = require("socket.io");
const _indicatorcalculator = require("./indicator.calculator");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let CollectorGateway = class CollectorGateway {
    afterInit() {
        this.logger.log('CollectorGateway initialized (Socket.IO /collector)');
    }
    handleConnection(client) {
        this.connectedClients.add(client.id);
        this.logger.log(`✅ Client connected: ${client.id} (Total: ${this.connectedClients.size})`);
    }
    handleDisconnect(client) {
        this.connectedClients.delete(client.id);
        this.logger.log(`❌ Client disconnected: ${client.id} (Total: ${this.connectedClients.size})`);
    }
    /**
   * Emit a candle update to all connected clients.
   */ emitCandleUpdate(row) {
        if (this.connectedClients.size === 0) {
            this.logger.warn(`⚠️  No clients connected - skipping candle:update for ${row.symbol}`);
            return;
        }
        // Use original timestamp if available (from CandleBuilder), otherwise reconstruct
        let unixSeconds;
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
        const payload = {
            symbol: row.symbol,
            date: row.date,
            candle: {
                time: unixSeconds,
                open: row.open,
                high: row.high,
                low: row.low,
                close: row.close,
                volume: row.volume
            },
            indicators: {
                vwap: row.vwap,
                ema9: row.ema9,
                ema20: row.ema20,
                atr: row.atr,
                high_of_day: row.high_of_day,
                low_of_day: row.low_of_day
            },
            debug: {
                originalTimestampMs: row.original_timestamp_ms,
                etString: `${row.date} ${row.candle_time_et}:00`
            }
        };
        this.logger.log(`📊 Emitting candle:update → ${row.symbol} ${row.candle_time_et} close=${row.close.toFixed(3)} time=${unixSeconds} (orig=${row.original_timestamp_ms}) to ${this.connectedClients.size} clients`);
        this.server.emit('candle:update', payload);
    }
    /**
   * Emit a live (in-progress) candle tick so the UI chart updates in real time.
   */ emitCandleLive(symbol, candle) {
        if (this.connectedClients.size === 0) {
            return; // Skip live ticks if no clients (too noisy to log)
        }
        // Ensure timestamp is always in unix seconds for UI consistency 
        // candle.t should already be unix milliseconds from CandleBuilder
        const unixSeconds = Math.floor(candle.t / 1000);
        const { date } = (0, _indicatorcalculator.timestampToET)(candle.t);
        const payload = {
            symbol,
            date,
            candle: {
                time: unixSeconds,
                open: candle.o,
                high: candle.h,
                low: candle.l,
                close: candle.c,
                volume: candle.v
            },
            indicators: {
                vwap: 0,
                ema9: 0,
                ema20: 0,
                atr: 0,
                high_of_day: 0,
                low_of_day: 0
            },
            debug: {
                originalTimestampMs: candle.t,
                etString: `live tick from ${symbol}`
            }
        };
        this.logger.debug(`📈 Emitting candle:live → ${symbol} price=${candle.c.toFixed(3)} time=${unixSeconds} (ms=${candle.t})`);
        this.server.emit('candle:live', payload);
    }
    /**
   * Emit updated list of active symbols.
   */ emitSymbolsUpdate(symbols) {
        this.logger.log(`📋 Emitting symbols:update → ${symbols.length} symbols: [${symbols.join(', ')}] to ${this.connectedClients.size} clients`);
        this.server.emit('symbols:update', {
            symbols
        });
    }
    /**
   * Get debug info about connected clients.
   */ getConnectionInfo() {
        return {
            connectedClients: this.connectedClients.size,
            clientIds: [
                ...this.connectedClients
            ],
            namespace: '/collector'
        };
    }
    /**
   * Emit an ML predict signal (every candle close when auto-predict is on).
   */ emitPredictSignal(payload) {
        this.server.emit('predict:signal', payload);
    }
    /**
   * Emit a trade entry notification.
   */ emitTradeEntry(payload) {
        this.server.emit('trade:entry', payload);
    }
    /**
   * Emit a trade exit notification.
   */ emitTradeExit(payload) {
        this.server.emit('trade:exit', payload);
    }
    constructor(){
        this.logger = new _common.Logger(CollectorGateway.name);
        this.connectedClients = new Set();
    }
};
_ts_decorate([
    (0, _websockets.WebSocketServer)(),
    _ts_metadata("design:type", typeof _socketio.Server === "undefined" ? Object : _socketio.Server)
], CollectorGateway.prototype, "server", void 0);
CollectorGateway = _ts_decorate([
    (0, _websockets.WebSocketGateway)({
        cors: {
            origin: '*'
        },
        namespace: '/collector'
    })
], CollectorGateway);

//# sourceMappingURL=collector.gateway.js.map