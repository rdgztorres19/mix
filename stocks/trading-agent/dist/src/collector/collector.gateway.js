"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var CollectorGateway_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectorGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const common_1 = require("@nestjs/common");
const socket_io_1 = require("socket.io");
const indicator_calculator_1 = require("./indicator.calculator");
let CollectorGateway = CollectorGateway_1 = class CollectorGateway {
    constructor() {
        this.logger = new common_1.Logger(CollectorGateway_1.name);
        this.connectedClients = new Set();
    }
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
    emitCandleUpdate(row) {
        if (this.connectedClients.size === 0) {
            this.logger.warn(`⚠️  No clients connected - skipping candle:update for ${row.symbol}`);
            return;
        }
        let unixSeconds;
        if (row.original_timestamp_ms) {
            unixSeconds = Math.floor(row.original_timestamp_ms / 1000);
        }
        else {
            const etTimeString = `${row.date} ${row.candle_time_et}:00`;
            const etDate = new Date(`${etTimeString} GMT-0500`);
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
    emitCandleLive(symbol, candle) {
        if (this.connectedClients.size === 0) {
            return;
        }
        const unixSeconds = Math.floor(candle.t / 1000);
        const { date } = (0, indicator_calculator_1.timestampToET)(candle.t);
        const payload = {
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
    emitSymbolsUpdate(symbols) {
        this.logger.log(`📋 Emitting symbols:update → ${symbols.length} symbols: [${symbols.join(', ')}] to ${this.connectedClients.size} clients`);
        this.server.emit('symbols:update', { symbols });
    }
    getConnectionInfo() {
        return {
            connectedClients: this.connectedClients.size,
            clientIds: [...this.connectedClients],
            namespace: '/collector',
        };
    }
    emitPredictSignal(payload) {
        this.server.emit('predict:signal', payload);
    }
    emitTradeEntry(payload) {
        this.server.emit('trade:entry', payload);
    }
    emitTradeExit(payload) {
        this.server.emit('trade:exit', payload);
    }
};
exports.CollectorGateway = CollectorGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], CollectorGateway.prototype, "server", void 0);
exports.CollectorGateway = CollectorGateway = CollectorGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: { origin: '*' },
        namespace: '/collector',
    })
], CollectorGateway);
//# sourceMappingURL=collector.gateway.js.map