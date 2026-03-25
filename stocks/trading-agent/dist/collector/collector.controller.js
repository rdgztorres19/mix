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
const _collectorfeaturepreviewservice = require("./collector-feature-preview.service");
const _collectorfeaturestodaydto = require("./dto/collector-features-today.dto");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
function _ts_param(paramIndex, decorator) {
    return function(target, key) {
        decorator(target, key, paramIndex);
    };
}
let CollectorController = class CollectorController {
    /**
   * POST /collector/features/today-candles
   * Read-only feature extraction (no MySQL writes/deletes).
   * Body: { symbols?: string[], symbolsCsv?: string, date?: YYYY-MM-DD, includeCandles?: boolean }
   */ async getTodayCandleFeatures(body) {
        return this.featurePreview.buildFeaturesForSymbolsByDate(body);
    }
    /**
   * POST /collector/sync-symbol-date
   * Fetches 1m bars from Alpaca for symbol+date, deletes existing rows,
   * builds training rows with unified features, bulk inserts.
   * Body: { symbol: string, date: string } (date YYYY-MM-DD)
   */ async syncSymbolDate(body) {
        const { symbol, date } = body;
        if (!symbol || !date) {
            return {
                ok: false,
                rows: 0,
                error: 'symbol and date required'
            };
        }
        return this.collector.syncSymbolDate(symbol, date);
    }
    /**
   * POST /collector/sync-date
   * Syncs ALL symbols that exist in DB for the given date.
   * Fetches each from Alpaca, deletes existing rows, rebuilds with unified features.
   * Body: { date: string } (YYYY-MM-DD)
   */ async syncDate(body) {
        const { date } = body;
        if (!date) {
            return {
                ok: false,
                symbols: 0,
                totalRows: 0,
                errors: [
                    'date required'
                ]
            };
        }
        return this.collector.syncDate(date);
    }
    /**
   * POST /collector/sync-today
   * Fetches top gainers from HPG or Alpaca screener, syncs each from Alpaca to MySQL.
   * Body: { source: 'hpg' | 'alpaca_screener' }
   */ async syncToday(body) {
        const source = body?.source ?? 'hpg';
        return this.collector.syncTodayFromSource(source);
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
   * Debug endpoint: show status of both Alpaca and MoMo streams, positions, last bar times.
   */ async getStreamStatus() {
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
            positions: positions.map((p)=>({
                    id: p.id,
                    symbol: p.symbol,
                    entry_time: p.entry_time,
                    entry_price: p.entry_price,
                    qty: p.qty,
                    entry_candle_idx: p.entry_candle_idx,
                    candles_elapsed: p.candles_elapsed,
                    alpaca_order_id: p.alpaca_order_id
                })),
            lastBarTimes
        };
    }
    constructor(collector, featurePreview, webSocketInit, positionTracker){
        this.collector = collector;
        this.featurePreview = featurePreview;
        this.webSocketInit = webSocketInit;
        this.positionTracker = positionTracker;
    }
};
_ts_decorate([
    (0, _common.Post)('features/today-candles'),
    _ts_param(0, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _collectorfeaturestodaydto.CollectorFeaturesTodayDto === "undefined" ? Object : _collectorfeaturestodaydto.CollectorFeaturesTodayDto
    ]),
    _ts_metadata("design:returntype", Promise)
], CollectorController.prototype, "getTodayCandleFeatures", null);
_ts_decorate([
    (0, _common.Post)('sync-symbol-date'),
    _ts_param(0, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", Promise)
], CollectorController.prototype, "syncSymbolDate", null);
_ts_decorate([
    (0, _common.Post)('sync-date'),
    _ts_param(0, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
    _ts_metadata("design:returntype", Promise)
], CollectorController.prototype, "syncDate", null);
_ts_decorate([
    (0, _common.Post)('sync-today'),
    _ts_param(0, (0, _common.Body)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        Object
    ]),
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
    _ts_param(2, (0, _common.Optional)()),
    _ts_param(3, (0, _common.Optional)()),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _collectorservice.CollectorService === "undefined" ? Object : _collectorservice.CollectorService,
        typeof _collectorfeaturepreviewservice.CollectorFeaturePreviewService === "undefined" ? Object : _collectorfeaturepreviewservice.CollectorFeaturePreviewService,
        Object,
        Object
    ])
], CollectorController);

//# sourceMappingURL=collector.controller.js.map