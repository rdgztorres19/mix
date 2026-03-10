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
        this.logger.debug(`Client connected: ${client.id}`);
    }
    handleDisconnect(client) {
        this.logger.debug(`Client disconnected: ${client.id}`);
    }
    /**
   * Emit a candle update to all connected clients.
   */ emitCandleUpdate(row) {
        const payload = {
            symbol: row.symbol,
            date: row.date,
            candle: {
                time: Math.floor(new Date(`${row.date}T${row.candle_time_et}:00`).getTime() / 1000),
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
            }
        };
        this.server.emit('candle:update', payload);
    }
    /**
   * Emit a live (in-progress) candle tick so the UI chart updates in real time.
   */ emitCandleLive(symbol, candle) {
        const { date } = (0, _indicatorcalculator.timestampToET)(candle.t);
        const payload = {
            symbol,
            date,
            candle: {
                time: Math.floor(candle.t / 1000),
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
            }
        };
        this.server.emit('candle:live', payload);
    }
    /**
   * Emit updated list of active symbols.
   */ emitSymbolsUpdate(symbols) {
        this.server.emit('symbols:update', {
            symbols
        });
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