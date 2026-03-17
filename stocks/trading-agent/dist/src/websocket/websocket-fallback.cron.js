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
var WebSocketFallbackCron_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketFallbackCron = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const config_1 = require("@nestjs/config");
const alpaca_websocket_service_1 = require("./alpaca-websocket.service");
const alpaca_datasource_1 = require("../scanner/datasource/alpaca-datasource");
let WebSocketFallbackCron = WebSocketFallbackCron_1 = class WebSocketFallbackCron {
    constructor(configService, alpacaWebSocket, alpacaDataSource, collector) {
        this.configService = configService;
        this.alpacaWebSocket = alpacaWebSocket;
        this.alpacaDataSource = alpacaDataSource;
        this.collector = collector;
        this.logger = new common_1.Logger(WebSocketFallbackCron_1.name);
        this.checkIntervalSeconds = 61;
        this.enabled = configService.get('WEBSOCKET_FALLBACK_ENABLED', true);
        this.symbols = configService.get('ALPACA_WEBSOCKET_SYMBOLS', 'ACXP')
            .split(',')
            .map(s => s.trim());
        this.logger.log(`🔍 WebSocket Fallback Cron initialized - uses dynamic symbols from CollectorService`);
    }
    async checkWebSocketHealth() {
        if (!this.enabled || !this.collector)
            return;
        const symbols = this.collector.getSymbolsList();
        if (symbols.length === 0)
            return;
        const now = Math.floor(Date.now() / 1000);
        const expectedBarTime = this.getExpectedBarTime(now);
        if (!this.alpacaWebSocket.isConnected()) {
            this.alpacaWebSocket.triggerReconnectIfDisconnected();
            this.logger.log(`🔌 WebSocket disconnected - fetching fallback for ${symbols.length} symbols via REST`);
            for (const symbol of symbols) {
                await this.fetchFallbackData(symbol, expectedBarTime);
            }
            return;
        }
        for (const symbol of symbols) {
            await this.checkSymbolData(symbol, expectedBarTime);
        }
    }
    toUnixSeconds(v) {
        if (v == null)
            return null;
        if (typeof v === 'number') {
            return v > 1e12 ? Math.floor(v / 1000) : v;
        }
        const parsed = Date.parse(String(v));
        return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
    }
    async checkSymbolData(symbol, expectedBarTime) {
        const raw = this.alpacaWebSocket.getLastBarTime(symbol);
        const lastBarTimeSec = this.toUnixSeconds(raw);
        const isDataMissing = lastBarTimeSec == null || Math.abs(lastBarTimeSec - expectedBarTime) > 30;
        if (isDataMissing) {
            this.logger.warn(`⚠️ Missing WebSocket data for ${symbol} at ${new Date(expectedBarTime * 1000).toISOString()}`);
            await this.fetchFallbackData(symbol, expectedBarTime);
        }
        else {
        }
    }
    async fetchFallbackData(symbol, barTime) {
        try {
            const startDate = new Date(barTime * 1000);
            const endDate = new Date((barTime + 60) * 1000);
            const startTime = startDate.toISOString().slice(0, 19) + 'Z';
            const endTime = endDate.toISOString().slice(0, 19) + 'Z';
            this.logger.log(`🔄 Fetching fallback data for ${symbol}: ${startTime}`);
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
                let tsMs = null;
                if (typeof bar.t === 'number') {
                    tsMs = Number.isFinite(bar.t) ? bar.t * 1000 : null;
                }
                else if (typeof bar.t === 'string') {
                    const parsed = Date.parse(bar.t);
                    tsMs = Number.isNaN(parsed) ? null : parsed;
                }
                if (!Number.isFinite(tsMs)) {
                    this.logger.warn(`⚠️ Fallback bar has invalid timestamp for ${symbol}: ${JSON.stringify(bar)}`);
                    return;
                }
                if (this.collector) {
                    await this.collector.onCandleClosed(symbol, {
                        o: bar.o,
                        h: bar.h,
                        l: bar.l,
                        c: bar.c,
                        v: bar.v,
                        t: tsMs,
                    });
                    this.logger.log(`📡 Fallback bar forwarded to collector for ${symbol} at ${new Date(tsMs).toISOString()}`);
                }
                else {
                    this.logger.warn('⚠️ CollectorService not available - cannot forward fallback bar');
                }
            }
            else {
                this.logger.warn(`⚠️ No fallback data available for ${symbol} at ${startTime}`);
                const fallbackUrl = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?feed=sip&timeframe=1Min&start=${startTime}&end=${endTime}&limit=1`;
                this.logger.warn(`   URL: ${fallbackUrl}`);
            }
        }
        catch (error) {
            this.logger.error(`❌ Fallback fetch failed for ${symbol}:`, error.message);
        }
    }
    getExpectedBarTime(currentUnixTime) {
        const currentDate = new Date(currentUnixTime * 1000);
        const expectedDate = new Date(currentDate);
        expectedDate.setMinutes(expectedDate.getMinutes() - 1);
        expectedDate.setSeconds(0);
        expectedDate.setMilliseconds(0);
        return Math.floor(expectedDate.getTime() / 1000);
    }
    async triggerFallbackCheck() {
        this.logger.log('🔧 Manual fallback check triggered');
        await this.checkWebSocketHealth();
    }
};
exports.WebSocketFallbackCron = WebSocketFallbackCron;
__decorate([
    (0, schedule_1.Cron)('1,5 * * * * *', { name: 'websocket-fallback-check' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], WebSocketFallbackCron.prototype, "checkWebSocketHealth", null);
exports.WebSocketFallbackCron = WebSocketFallbackCron = WebSocketFallbackCron_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(3, (0, common_1.Optional)()),
    __param(3, (0, common_1.Inject)('COLLECTOR_SERVICE')),
    __metadata("design:paramtypes", [config_1.ConfigService,
        alpaca_websocket_service_1.AlpacaWebSocketService,
        alpaca_datasource_1.AlpacaDataSource, Function])
], WebSocketFallbackCron);
//# sourceMappingURL=websocket-fallback.cron.js.map