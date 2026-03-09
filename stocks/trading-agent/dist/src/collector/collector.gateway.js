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
    }
    afterInit() {
        this.logger.log('CollectorGateway initialized (Socket.IO /collector)');
    }
    handleConnection(client) {
        this.logger.debug(`Client connected: ${client.id}`);
    }
    handleDisconnect(client) {
        this.logger.debug(`Client disconnected: ${client.id}`);
    }
    emitCandleUpdate(row) {
        const payload = {
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
    emitCandleLive(symbol, candle) {
        const { date } = (0, indicator_calculator_1.timestampToET)(candle.t);
        const payload = {
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
    emitSymbolsUpdate(symbols) {
        this.server.emit('symbols:update', { symbols });
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