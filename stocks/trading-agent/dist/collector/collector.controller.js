"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "CollectorController", {
    enumerable: true,
    get: function() {
        return CollectorController;
    }
});
const _common = require("@nestjs/common");
const _collectorservice = require("./collector.service");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let CollectorController = class CollectorController {
    /**
   * POST /collector/sync-today
   * Triggers a MoMo refresh for today's candles (skips after hours).
   */ async syncToday() {
        const result = await this.collector.refreshAllFromMomo({
            force: true
        });
        return {
            ok: true,
            ...result
        };
    }
    /**
   * GET /collector/status
   * Debug endpoint: active symbols and MoMo subscription status.
   */ async getStatus() {
        return this.collector.getDebugStatus();
    }
    /**
   * POST /collector/force-resync
   * Force re-subscription to all active symbols.
   */ async forceResync() {
        return this.collector.forceResubscribeAll();
    }
    /**
   * POST /collector/test-scan
   * Manually trigger a MoMo scan.
   */ async testScan() {
        const newSymbols = await this.collector.scanMomo();
        return {
            ok: true,
            newSymbols
        };
    }
    /**
   * GET /collector/websocket-stats
   * Debug endpoint: WebSocket data flow statistics.
   */ async getWebSocketStats() {
        return this.collector.getWebSocketStats();
    }
    /**
   * GET /collector/debug-streams
   * Debug endpoint: show status of both Alpaca and MoMo streams.
   */ async getStreamStatus() {
        const alpacaConnected = this.collector['webSocketInit']?.isAlpacaConnected() ?? false;
        const alpacaSubscriptions = alpacaConnected ? Array.from(this.collector['webSocketInit']?.['alpacaWebSocket']?.subscriptions || []) : [];
        const momoConnected = this.collector['momoStream']?.isConnected() ?? false;
        const momoSubscriptions = this.collector['momoStream']?.getSubscribedSymbols() ?? [];
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
            primaryStream: alpacaConnected ? 'Alpaca Premium' : 'MoMo Fallback'
        };
    }
    constructor(collector){
        this.collector = collector;
    }
};
_ts_decorate([
    (0, _common.Post)('sync-today'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CollectorController.prototype, "syncToday", null);
_ts_decorate([
    (0, _common.Get)('status'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CollectorController.prototype, "getStatus", null);
_ts_decorate([
    (0, _common.Post)('force-resync'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CollectorController.prototype, "forceResync", null);
_ts_decorate([
    (0, _common.Post)('test-scan'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CollectorController.prototype, "testScan", null);
_ts_decorate([
    (0, _common.Get)('websocket-stats'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CollectorController.prototype, "getWebSocketStats", null);
_ts_decorate([
    (0, _common.Get)('debug-streams'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], CollectorController.prototype, "getStreamStatus", null);
CollectorController = _ts_decorate([
    (0, _common.Controller)('collector'),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _collectorservice.CollectorService === "undefined" ? Object : _collectorservice.CollectorService
    ])
], CollectorController);

//# sourceMappingURL=collector.controller.js.map