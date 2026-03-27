"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WebSocketFallbackCron", {
    enumerable: true,
    get: function() {
        return WebSocketFallbackCron;
    }
});
const _common = require("@nestjs/common");
const _schedule = require("@nestjs/schedule");
const _config = require("@nestjs/config");
const _alpacawebsocketservice = require("./alpaca-websocket.service");
const _alpacadatasource = require("../scanner/datasource/alpaca-datasource");
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
let WebSocketFallbackCron = class WebSocketFallbackCron {
    /**
   * Twice per minute (at :01 and :05) in Eastern Time, hours 04–23 only (through end of session day).
   * When WebSocket connected: check if bars received; if missing, fetch via REST.
   * When WebSocket disconnected: fetch bars for all active symbols via REST (historical fallback).
   */ async checkWebSocketHealth() {
        if (!this.enabled || !this.collector) return;
        const symbols = this.collector.getSymbolsList();
        if (symbols.length === 0) return;
        const now = Math.floor(Date.now() / 1000);
        const expectedBarTime = this.getExpectedBarTime(now);
        if (!this.alpacaWebSocket.isConnected()) {
            this.alpacaWebSocket.triggerReconnectIfDisconnected();
            this.logger.log(`🔌 WebSocket disconnected - fetching fallback for ${symbols.length} symbols via REST`);
            for (const symbol of symbols){
                await this.fetchFallbackData(symbol, expectedBarTime);
            }
            return;
        }
        for (const symbol of symbols){
            await this.checkSymbolData(symbol, expectedBarTime);
        }
    }
    /** Normalize timestamp to unix seconds (handles number seconds, number ms, or ISO string) */ toUnixSeconds(v) {
        if (v == null) return null;
        if (typeof v === 'number') {
            return v > 1e12 ? Math.floor(v / 1000) : v;
        }
        const parsed = Date.parse(String(v));
        return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
    }
    async checkSymbolData(symbol, expectedBarTime) {
        const raw = this.alpacaWebSocket.getLastBarTime(symbol);
        const lastBarTimeSec = this.toUnixSeconds(raw);
        // Check if we received data for the expected minute (30 second tolerance)
        const isDataMissing = lastBarTimeSec == null || Math.abs(lastBarTimeSec - expectedBarTime) > 30;
        if (isDataMissing) {
            this.logger.warn(`⚠️ Missing WebSocket data for ${symbol} at ${new Date(expectedBarTime * 1000).toISOString()}`);
            await this.fetchFallbackData(symbol, expectedBarTime);
        } else {
        //this.logger.debug(`✅ WebSocket data OK for ${symbol}`);
        }
    }
    async fetchFallbackData(symbol, barTime) {
        try {
            // Fetch a small 1-minute window [barTime, barTime+60s) to increase chance of a bar
            const startDate = new Date(barTime * 1000);
            const endDate = new Date((barTime + 60) * 1000);
            const startTime = startDate.toISOString().slice(0, 19) + 'Z';
            const endTime = endDate.toISOString().slice(0, 19) + 'Z';
            //this.logger.log(`🔄 Fetching fallback data for ${symbol}: ${startTime}`);
            // Use AlpacaDataSource to fetch the missing bar
            const response = await this.alpacaDataSource.fetchBarsFromAlpacaDirect({
                symbol,
                timeframe: '1Min',
                start: startTime,
                end: endTime,
                feed: 'sip',
                limit: 1
            });
            if (response && response.bars && response.bars[symbol] && response.bars[symbol].length > 0) {
                const bar = response.bars[symbol][0];
                this.logger.log(`✅ Fallback data retrieved for ${symbol}: $${bar.c} (Vol: ${bar.v})`);
                // Normalize timestamp to ms (supports unix seconds or ISO string)
                let tsMs = null;
                if (typeof bar.t === 'number') {
                    tsMs = Number.isFinite(bar.t) ? bar.t * 1000 : null;
                } else if (typeof bar.t === 'string') {
                    const parsed = Date.parse(bar.t);
                    tsMs = Number.isNaN(parsed) ? null : parsed;
                }
                if (!Number.isFinite(tsMs)) {
                    this.logger.warn(`⚠️ Fallback bar has invalid timestamp for ${symbol}: ${JSON.stringify(bar)}`);
                    return;
                }
                // If CollectorService is available, process this bar as a closed candle
                if (this.collector) {
                    await this.collector.onCandleClosed(symbol, {
                        o: bar.o,
                        h: bar.h,
                        l: bar.l,
                        c: bar.c,
                        v: bar.v,
                        t: tsMs
                    });
                    this.logger.log(`📡 Fallback bar forwarded to collector for ${symbol} at ${new Date(tsMs).toISOString()}`);
                } else {
                    this.logger.warn('⚠️ CollectorService not available - cannot forward fallback bar');
                }
            } else {
                this.logger.warn(`⚠️ No fallback data available for ${symbol} at ${startTime}`);
                const fallbackUrl = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?feed=sip&timeframe=1Min&start=${startTime}&end=${endTime}&limit=1`;
                this.logger.warn(`   URL: ${fallbackUrl}`);
            }
        } catch (error) {
            this.logger.error(`❌ Fallback fetch failed for ${symbol}:`, error.message);
        }
    }
    /**
   * Calculate the expected bar time for the previous completed minute.
   * Example: if now is 16:48:37, expected bar time is 16:47:00
   */ getExpectedBarTime(currentUnixTime) {
        const currentDate = new Date(currentUnixTime * 1000);
        // Get the previous completed minute
        const expectedDate = new Date(currentDate);
        expectedDate.setMinutes(expectedDate.getMinutes() - 1);
        expectedDate.setSeconds(0);
        expectedDate.setMilliseconds(0);
        return Math.floor(expectedDate.getTime() / 1000);
    }
    /**
   * Manual trigger for testing fallback functionality
   */ async triggerFallbackCheck() {
        this.logger.log('🔧 Manual fallback check triggered');
        await this.checkWebSocketHealth();
    }
    constructor(configService, alpacaWebSocket, alpacaDataSource, collector){
        this.configService = configService;
        this.alpacaWebSocket = alpacaWebSocket;
        this.alpacaDataSource = alpacaDataSource;
        this.collector = collector;
        this.logger = new _common.Logger(WebSocketFallbackCron.name);
        this.checkIntervalSeconds = 61; // Check every 61 seconds
        this.enabled = configService.get('WEBSOCKET_FALLBACK_ENABLED', true);
        this.symbols = configService.get('ALPACA_WEBSOCKET_SYMBOLS', 'ACXP').split(',').map((s)=>s.trim());
        this.logger.log(`🔍 WebSocket Fallback Cron initialized - uses dynamic symbols from CollectorService`);
    }
};
_ts_decorate([
    (0, _schedule.Cron)('1,5 * 4-14 * * *', {
        name: 'websocket-fallback-check',
        timeZone: 'America/New_York'
    }),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", []),
    _ts_metadata("design:returntype", Promise)
], WebSocketFallbackCron.prototype, "checkWebSocketHealth", null);
WebSocketFallbackCron = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_param(3, (0, _common.Optional)()),
    _ts_param(3, (0, _common.Inject)('COLLECTOR_SERVICE')),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _config.ConfigService === "undefined" ? Object : _config.ConfigService,
        typeof _alpacawebsocketservice.AlpacaWebSocketService === "undefined" ? Object : _alpacawebsocketservice.AlpacaWebSocketService,
        typeof _alpacadatasource.AlpacaDataSource === "undefined" ? Object : _alpacadatasource.AlpacaDataSource,
        typeof CollectorService === "undefined" ? Object : CollectorService
    ])
], WebSocketFallbackCron);

//# sourceMappingURL=websocket-fallback.cron.js.map