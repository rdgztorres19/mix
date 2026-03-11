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
var WebSocketInitService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketInitService = void 0;
const common_1 = require("@nestjs/common");
const alpaca_websocket_service_1 = require("./alpaca-websocket.service");
const collector_service_1 = require("../collector/collector.service");
let WebSocketInitService = WebSocketInitService_1 = class WebSocketInitService {
    constructor(alpacaWebSocket, collector) {
        this.alpacaWebSocket = alpacaWebSocket;
        this.collector = collector;
        this.logger = new common_1.Logger(WebSocketInitService_1.name);
    }
    async onModuleInit() {
        this.logger.log('🚀 Initializing Alpaca WebSocket connection...');
        try {
            await this.alpacaWebSocket.connect();
            this.alpacaWebSocket.onBar(async (bar) => {
                const tsMs = typeof bar.timestamp === 'number'
                    ? bar.timestamp * 1000
                    : Number.isFinite(Date.parse(String(bar.timestamp)))
                        ? Date.parse(String(bar.timestamp))
                        : NaN;
                if (!Number.isFinite(tsMs)) {
                    this.logger.warn(`⚠️ Skipping bar with invalid timestamp for ${bar.symbol}: ${JSON.stringify(bar)}`);
                    return;
                }
                const candle = {
                    o: bar.open,
                    h: bar.high,
                    l: bar.low,
                    c: bar.close,
                    v: bar.volume,
                    t: tsMs,
                };
                this.logger.log(`📊 Real-time bar → collector: ${bar.symbol} close=${bar.close} vol=${bar.volume} ts=${new Date(tsMs).toISOString()}`);
                try {
                    await this.collector.onCandleClosed(bar.symbol, candle);
                }
                catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    this.logger.error(`❌ Failed to process real-time bar for ${bar.symbol}: ${msg}`);
                }
            });
            await new Promise(resolve => setTimeout(resolve, 2000));
            this.logger.log('🔗 WebSocket ready for dynamic subscriptions');
        }
        catch (error) {
            this.logger.error('❌ Failed to initialize WebSocket:', error.message);
        }
    }
    async subscribeToSymbols(symbols) {
        if (symbols.length === 0)
            return;
        this.logger.log(`🎯 Updating Alpaca WebSocket subscriptions: [${symbols.join(', ')}]`);
        try {
            await this.alpacaWebSocket.subscribe(symbols);
        }
        catch (error) {
            this.logger.error(`❌ Failed to subscribe to symbols: ${error.message}`);
        }
    }
    async unsubscribeFromSymbols(symbols) {
        if (symbols.length === 0)
            return;
        this.logger.log(`🚫 Removing Alpaca WebSocket subscriptions: [${symbols.join(', ')}]`);
        try {
            await this.alpacaWebSocket.unsubscribe(symbols);
        }
        catch (error) {
            this.logger.error(`❌ Failed to unsubscribe from symbols: ${error.message}`);
        }
    }
    isAlpacaConnected() {
        return this.alpacaWebSocket.isConnected();
    }
    async refreshSubscriptions(activeSymbols) {
        this.logger.log(`🔄 Refreshing Alpaca WebSocket subscriptions for ${activeSymbols.length} active symbols...`);
        const currentSubscriptions = Array.from(this.alpacaWebSocket.subscriptions || []);
        const toUnsubscribe = currentSubscriptions.filter(symbol => !activeSymbols.includes(symbol));
        if (toUnsubscribe.length > 0) {
            this.logger.log(`🚫 Removing ${toUnsubscribe.length} inactive subscriptions: [${toUnsubscribe.join(', ')}]`);
            await this.unsubscribeFromSymbols(toUnsubscribe);
        }
        const toSubscribe = activeSymbols.filter(symbol => !currentSubscriptions.includes(symbol));
        if (toSubscribe.length > 0) {
            this.logger.log(`📈 Adding ${toSubscribe.length} new subscriptions: [${toSubscribe.join(', ')}]`);
            await this.subscribeToSymbols(toSubscribe);
        }
        if (toUnsubscribe.length === 0 && toSubscribe.length === 0) {
            this.logger.log('✅ Subscriptions already up-to-date');
        }
    }
    async onModuleDestroy() {
        this.logger.log('👋 Shutting down WebSocket connections...');
        await this.alpacaWebSocket.disconnect();
    }
};
exports.WebSocketInitService = WebSocketInitService;
exports.WebSocketInitService = WebSocketInitService = WebSocketInitService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => collector_service_1.CollectorService))),
    __metadata("design:paramtypes", [alpaca_websocket_service_1.AlpacaWebSocketService,
        collector_service_1.CollectorService])
], WebSocketInitService);
//# sourceMappingURL=websocket-init.service.js.map