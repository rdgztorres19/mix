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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var AlpacaWebSocketService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlpacaWebSocketService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const ws_1 = __importDefault(require("ws"));
let AlpacaWebSocketService = AlpacaWebSocketService_1 = class AlpacaWebSocketService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(AlpacaWebSocketService_1.name);
        this.ws = null;
        this.isAuthenticated = false;
        this.subscriptions = new Set();
        this.lastSubscriptionsBeforeDisconnect = [];
        this.barCallbacks = [];
        this.authCallbacks = [];
        this.reconnectTimeoutId = null;
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.intentionalDisconnect = false;
        this.pingInterval = null;
        this.lastBarTimes = new Map();
        this.wsUrl = 'wss://stream.data.alpaca.markets/v2/sip';
        this.alpacaKeyId =
            configService.get('ALPACA_KEY_ID') ||
                'PKBLVB6V5QWCSU2TLPHJ';
        this.alpacaSecretKey =
            configService.get('ALPACA_SECRET_KEY') ||
                'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG';
        this.config = {
            enabled: configService.get('ALPACA_WEBSOCKET_ENABLED', true),
            reconnectIntervalMs: configService.get('ALPACA_RECONNECT_INTERVAL_MS', 5000),
            symbols: [],
        };
        this.logger.log(`🚀 Alpaca WebSocket initialized`);
    }
    async connect() {
        if (!this.config.enabled)
            return;
        this.intentionalDisconnect = false;
        if (this.ws) {
            try {
                this.ws.removeAllListeners();
                this.ws.terminate();
            }
            catch { }
            this.ws = null;
        }
        this.logger.log('📡 Connecting to Alpaca WebSocket...');
        this.ws = new ws_1.default(this.wsUrl);
        this.ws.on('open', () => this.handleOpen());
        this.ws.on('message', (data) => this.handleMessage(data));
        this.ws.on('close', (code, reason) => this.handleClose(code, reason));
        this.ws.on('error', (err) => this.handleError(err));
    }
    async disconnect() {
        this.intentionalDisconnect = true;
        if (this.reconnectTimeoutId) {
            clearTimeout(this.reconnectTimeoutId);
            this.reconnectTimeoutId = null;
        }
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.ws) {
            this.logger.log('👋 Disconnecting WebSocket');
            this.ws.close();
            this.ws = null;
        }
        this.isAuthenticated = false;
    }
    async subscribe(symbols) {
        if (!this.isAuthenticated) {
            this.logger.warn('⚠️ Cannot subscribe — not authenticated');
            return;
        }
        const newSymbols = symbols.filter(s => !this.subscriptions.has(s));
        if (!newSymbols.length)
            return;
        const msg = {
            action: 'subscribe',
            bars: newSymbols
        };
        this.logger.log(`📊 Subscribing ${newSymbols.join(', ')}`);
        this.ws?.send(JSON.stringify(msg));
        newSymbols.forEach(s => this.subscriptions.add(s));
    }
    async unsubscribe(symbols) {
        if (!this.isAuthenticated)
            return;
        const existing = symbols.filter(s => this.subscriptions.has(s));
        if (!existing.length)
            return;
        const msg = {
            action: 'unsubscribe',
            bars: existing
        };
        this.ws?.send(JSON.stringify(msg));
        existing.forEach(s => this.subscriptions.delete(s));
    }
    isConnected() {
        return this.ws?.readyState === ws_1.default.OPEN && this.isAuthenticated;
    }
    triggerReconnectIfDisconnected() {
        if (!this.config.enabled)
            return;
        if (this.isConnected())
            return;
        this.scheduleReconnect();
    }
    onBar(callback) {
        this.barCallbacks.push(callback);
    }
    onAuthenticated(callback) {
        this.authCallbacks.push(callback);
    }
    getLastBarTime(symbol) {
        return this.lastBarTimes.get(symbol) || null;
    }
    getSubscriptions() {
        return Array.from(this.subscriptions);
    }
    getLastBarTimesMap() {
        const out = {};
        for (const [sym, sec] of this.lastBarTimes.entries()) {
            out[sym] = sec;
        }
        return out;
    }
    handleOpen() {
        this.logger.log('✅ WebSocket connected — authenticating');
        const authMsg = {
            action: 'auth',
            key: this.alpacaKeyId,
            secret: this.alpacaSecretKey
        };
        this.ws?.send(JSON.stringify(authMsg));
    }
    handleMessage(data) {
        try {
            const messages = JSON.parse(data.toString());
            messages.forEach(msg => {
                switch (msg.T) {
                    case 'success':
                        if (msg.msg === 'authenticated') {
                            this.handleAuthenticated();
                        }
                        break;
                    case 'subscription':
                        this.logger.log('📋 Subscription confirmed');
                        break;
                    case 'b':
                        this.handleBar(msg);
                        break;
                    case 'error':
                        this.logger.error('❌ Server error', msg);
                        break;
                }
            });
        }
        catch (err) {
            this.logger.error(`❌ Parse error ${err.message}`);
        }
    }
    async handleAuthenticated() {
        this.logger.log('🎉 Authenticated');
        this.isAuthenticated = true;
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.startPing();
        if (this.lastSubscriptionsBeforeDisconnect.length) {
            await this.subscribe(this.lastSubscriptionsBeforeDisconnect);
        }
        for (const cb of this.authCallbacks) {
            await cb();
        }
    }
    handleBar(msg) {
        if (!msg.S || !msg.t || msg.o == null || msg.h == null || msg.l == null || msg.c == null || msg.v == null) {
            return;
        }
        let tsSec = 0;
        if (typeof msg.t === 'number') {
            tsSec = msg.t > 1e12 ? Math.floor(msg.t / 1000) : msg.t;
        }
        else {
            const ms = Date.parse(msg.t);
            tsSec = Math.floor(ms / 1000);
        }
        const bar = {
            symbol: msg.S,
            timestamp: tsSec,
            open: msg.o,
            high: msg.h,
            low: msg.l,
            close: msg.c,
            volume: msg.v,
            vwap: msg.vw,
            tradeCount: msg.n
        };
        this.lastBarTimes.set(bar.symbol, tsSec);
        this.barCallbacks.forEach(cb => {
            try {
                cb(bar);
            }
            catch (e) {
                this.logger.error(`callback error ${e.message}`);
            }
        });
    }
    handleClose(code, reason) {
        this.logger.warn(`🔌 Socket closed ${code} ${reason}`);
        this.lastSubscriptionsBeforeDisconnect = [...this.subscriptions];
        this.subscriptions.clear();
        this.isAuthenticated = false;
        this.ws = null;
        if (!this.intentionalDisconnect) {
            this.scheduleReconnect();
        }
    }
    handleError(err) {
        this.logger.error(`❌ WebSocket error ${err.message}`);
        if (this.ws) {
            try {
                this.ws.removeAllListeners();
                this.ws.terminate();
            }
            catch { }
        }
        this.ws = null;
        if (!this.isReconnecting) {
            this.scheduleReconnect();
        }
    }
    scheduleReconnect() {
        if (!this.config.enabled)
            return;
        if (this.isReconnecting)
            return;
        this.isReconnecting = true;
        this.reconnectAttempts++;
        const delay = Math.min(this.config.reconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts - 1), 60000);
        this.logger.log(`🔄 Reconnecting in ${delay / 1000}s`);
        this.reconnectTimeoutId = setTimeout(() => {
            this.isReconnecting = false;
            this.connect().catch(err => {
                this.logger.error(`Reconnect failed ${err.message}`);
                this.scheduleReconnect();
            });
        }, delay);
    }
    startPing() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === ws_1.default.OPEN) {
                try {
                    this.ws.ping();
                }
                catch { }
            }
        }, 30000);
    }
};
exports.AlpacaWebSocketService = AlpacaWebSocketService;
exports.AlpacaWebSocketService = AlpacaWebSocketService = AlpacaWebSocketService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AlpacaWebSocketService);
//# sourceMappingURL=alpaca-websocket.service.js.map