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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectorController = void 0;
const common_1 = require("@nestjs/common");
const collector_service_1 = require("./collector.service");
const websocket_init_service_1 = require("../websocket/websocket-init.service");
const position_tracker_service_1 = require("../trader/position-tracker.service");
let CollectorController = class CollectorController {
    constructor(collector, webSocketInit, positionTracker) {
        this.collector = collector;
        this.webSocketInit = webSocketInit;
        this.positionTracker = positionTracker;
    }
    async syncToday() {
        const result = await this.collector.refreshAllFromMomo({ force: true });
        return { ok: true, ...result };
    }
    async getStatus() {
        return this.collector.getDebugStatus();
    }
    async forceResync() {
        return this.collector.forceResubscribeAll();
    }
    async testScan() {
        const newSymbols = await this.collector.scanMomo();
        return { ok: true, newSymbols };
    }
    async getWebSocketStats() {
        return this.collector.getWebSocketStats();
    }
    async getStreamStatus() {
        const alpacaConnected = this.webSocketInit?.isAlpacaConnected() ?? false;
        const alpacaSubscriptions = this.webSocketInit?.getAlpacaSubscriptions() ?? [];
        const lastBarTimes = this.webSocketInit?.getLastBarTimesMap() ?? {};
        const momoConnected = this.collector['momoStream']?.isConnected() ?? false;
        const momoSubscriptions = this.collector['momoStream']?.getSubscribedSymbols() ?? [];
        const positions = this.positionTracker?.getAllOpen() ?? [];
        return {
            alpaca: {
                connected: alpacaConnected,
                subscriptions: alpacaSubscriptions,
                source: 'Premium SIP Feed'
            },
            momo: {
                connected: momoConnected,
                subscriptions: momoSubscriptions,
                source: 'MoMo Fallback'
            },
            activeSymbols: this.collector.getActiveSymbolList(),
            primaryStream: alpacaConnected ? 'Alpaca Premium' : 'MoMo Fallback',
            positions: positions.map(p => ({
                id: p.id,
                symbol: p.symbol,
                entry_time: p.entry_time,
                entry_price: p.entry_price,
                qty: p.qty,
                entry_candle_idx: p.entry_candle_idx,
                candles_elapsed: p.candles_elapsed,
                alpaca_order_id: p.alpaca_order_id,
            })),
            lastBarTimes,
        };
    }
};
exports.CollectorController = CollectorController;
__decorate([
    (0, common_1.Post)('sync-today'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectorController.prototype, "syncToday", null);
__decorate([
    (0, common_1.Get)('status'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectorController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Post)('force-resync'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectorController.prototype, "forceResync", null);
__decorate([
    (0, common_1.Post)('test-scan'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectorController.prototype, "testScan", null);
__decorate([
    (0, common_1.Get)('websocket-stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectorController.prototype, "getWebSocketStats", null);
__decorate([
    (0, common_1.Get)('debug-streams'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectorController.prototype, "getStreamStatus", null);
exports.CollectorController = CollectorController = __decorate([
    (0, common_1.Controller)('collector'),
    __param(1, (0, common_1.Optional)()),
    __param(2, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [collector_service_1.CollectorService,
        websocket_init_service_1.WebSocketInitService,
        position_tracker_service_1.PositionTrackerService])
], CollectorController);
//# sourceMappingURL=collector.controller.js.map