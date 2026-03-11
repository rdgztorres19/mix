"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "AlpacaWebSocketService", {
    enumerable: true,
    get: function() {
        return AlpacaWebSocketService;
    }
});
const _common = require("@nestjs/common");
const _config = require("@nestjs/config");
const _ws = /*#__PURE__*/ _interop_require_default(require("ws"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
function _ts_metadata(k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
}
let AlpacaWebSocketService = class AlpacaWebSocketService {
    async connect() {
        if (!this.config.enabled) {
            this.logger.warn('⚠️ Alpaca WebSocket disabled in config');
            return;
        }
        if (this.ws && this.ws.readyState === _ws.default.OPEN) {
            this.logger.warn('🔗 WebSocket already connected');
            return;
        }
        this.logger.log('📡 Connecting to Alpaca Premium SIP WebSocket...');
        this.ws = new _ws.default(this.wsUrl);
        this.ws.on('open', ()=>this.handleOpen());
        this.ws.on('message', (data)=>this.handleMessage(data));
        this.ws.on('close', (code, reason)=>this.handleClose(code, reason));
        this.ws.on('error', (error)=>this.handleError(error));
    }
    async disconnect() {
        if (this.ws) {
            this.logger.log('👋 Disconnecting WebSocket...');
            this.ws.close();
            this.ws = null;
            this.isAuthenticated = false;
            this.subscriptions.clear();
        }
    }
    async subscribe(symbols) {
        if (!this.isAuthenticated) {
            this.logger.warn('⚠️ Cannot subscribe - not authenticated');
            return;
        }
        const newSymbols = symbols.filter((s)=>!this.subscriptions.has(s));
        if (newSymbols.length === 0) {
            return;
        }
        const subscribeMessage = {
            action: 'subscribe',
            bars: newSymbols
        };
        this.logger.log(`📊 Subscribing to bars: [${newSymbols.join(', ')}]`);
        this.ws?.send(JSON.stringify(subscribeMessage));
        newSymbols.forEach((symbol)=>this.subscriptions.add(symbol));
    }
    async unsubscribe(symbols) {
        if (!this.isAuthenticated) return;
        const existingSymbols = symbols.filter((s)=>this.subscriptions.has(s));
        if (existingSymbols.length === 0) return;
        const unsubscribeMessage = {
            action: 'unsubscribe',
            bars: existingSymbols
        };
        this.logger.log(`📊 Unsubscribing from bars: [${existingSymbols.join(', ')}]`);
        this.ws?.send(JSON.stringify(unsubscribeMessage));
        existingSymbols.forEach((symbol)=>this.subscriptions.delete(symbol));
    }
    isConnected() {
        return this.ws?.readyState === _ws.default.OPEN && this.isAuthenticated;
    }
    getLastBarTime(symbol) {
        return this.lastBarTimes.get(symbol) || null;
    }
    onBar(callback) {
        this.barCallbacks.push(callback);
    }
    /** Called after authentication (including reconnect). Use to refresh subscriptions from CollectorService. */ onAuthenticated(callback) {
        this.authCallbacks.push(callback);
    }
    handleOpen() {
        this.logger.log('✅ WebSocket connected - authenticating...');
        const authMessage = {
            action: 'auth',
            key: this.alpacaKeyId,
            secret: this.alpacaSecretKey
        };
        this.ws?.send(JSON.stringify(authMessage));
    }
    handleMessage(data) {
        try {
            const messages = JSON.parse(data.toString());
            messages.forEach((msg)=>{
                switch(msg.T){
                    case 'success':
                        if (msg.msg === 'authenticated') {
                            this.handleAuthenticated();
                        }
                        break;
                    case 'subscription':
                        this.logger.log('📋 Subscription confirmed:', msg);
                        break;
                    case 'b':
                        this.handleBar(msg);
                        break;
                    case 'error':
                        this.logger.error('❌ Server error:', msg);
                        break;
                }
            });
        } catch (error) {
            this.logger.error('❌ Error parsing WebSocket message:', error.message);
        }
    }
    async handleAuthenticated() {
        this.logger.log('🎉 Authentication successful - Ready for dynamic subscriptions');
        this.isAuthenticated = true;
        if (this.lastSubscriptionsBeforeDisconnect.length > 0) {
            this.logger.log(`🔄 Re-subscribing to ${this.lastSubscriptionsBeforeDisconnect.length} symbols: [${this.lastSubscriptionsBeforeDisconnect.join(', ')}]`);
            await this.subscribe(this.lastSubscriptionsBeforeDisconnect);
        }
        for (const cb of this.authCallbacks){
            try {
                await cb();
            } catch (err) {
                this.logger.error(`Auth callback error: ${err.message}`);
            }
        }
    }
    handleBar(msg) {
        // Debug: log the raw message to understand actual format
        this.logger.debug(`📥 Raw bar message: ${JSON.stringify(msg)}`);
        if (!msg.S || !msg.t || msg.o == null || msg.h == null || msg.l == null || msg.c == null || msg.v == null) {
            this.logger.warn(`⚠️ Incomplete bar data received for ${msg.S}:`, {
                symbol: msg.S,
                timestamp: msg.t,
                hasOHLC: {
                    o: msg.o !== undefined,
                    h: msg.h !== undefined,
                    l: msg.l !== undefined,
                    c: msg.c !== undefined
                },
                volume: msg.v
            });
            return;
        }
        const ts = msg.t;
        let tsSec;
        if (typeof ts === 'number' && Number.isFinite(ts)) {
            tsSec = ts > 1e12 ? Math.floor(ts / 1000) : ts;
        } else if (typeof ts === 'string') {
            const ms = Date.parse(ts);
            tsSec = Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
        } else {
            tsSec = 0;
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
        // Update last bar time for fallback detection (always unix seconds)
        this.lastBarTimes.set(bar.symbol, tsSec);
        // Validate timestamp before logging
        let timestampStr = 'Invalid Date';
        if (typeof bar.timestamp === 'number' && bar.timestamp > 0) {
            try {
                timestampStr = new Date(bar.timestamp * 1000).toLocaleTimeString();
            } catch (error) {
                timestampStr = `Invalid (${bar.timestamp})`;
            }
        } else {
            timestampStr = `Invalid (${bar.timestamp})`;
        }
        const change = ((bar.close - bar.open) / bar.open * 100).toFixed(2);
        const emoji = parseFloat(change) >= 0 ? '📈' : '📉';
        this.logger.log(`
📊 1-MIN BAR ${bar.symbol}
⏰ ${timestampStr}
🟢 Open: $${bar.open} | 🔴 High: $${bar.high} | 🟡 Low: $${bar.low} | ⚫ Close: $${bar.close}
📦 Volume: ${bar.volume} ${emoji} ${change}%
    `);
        // Notify all registered callbacks
        this.barCallbacks.forEach((callback)=>{
            try {
                callback(bar);
            } catch (error) {
                this.logger.error('❌ Error in bar callback:', error.message);
            }
        });
    }
    handleClose(code, reason) {
        this.logger.warn(`🔌 WebSocket closed - Code: ${code}, Reason: ${reason}`);
        this.lastSubscriptionsBeforeDisconnect = Array.from(this.subscriptions);
        this.isAuthenticated = false;
        this.subscriptions.clear();
        // Reconnect after configured interval
        setTimeout(()=>{
            this.logger.log('🔄 Attempting to reconnect...');
            this.connect().catch((error)=>{
                this.logger.error('❌ Reconnection failed:', error.message);
            });
        }, this.config.reconnectIntervalMs);
    }
    handleError(error) {
        this.logger.error('❌ WebSocket error:', error.message);
    }
    constructor(configService){
        this.configService = configService;
        this.logger = new _common.Logger(AlpacaWebSocketService.name);
        this.ws = null;
        this.isAuthenticated = false;
        this.subscriptions = new Set();
        /** Saved before disconnect so we can re-subscribe on reconnect */ this.lastSubscriptionsBeforeDisconnect = [];
        this.barCallbacks = [];
        this.authCallbacks = [];
        // Track last received bar time for each symbol (for fallback detection)
        this.lastBarTimes = new Map();
        this.wsUrl = 'wss://stream.data.alpaca.markets/v2/sip';
        this.alpacaKeyId = configService.get('ALPACA_KEY_ID', 'PKBLVB6V5QWCSU2TLPHJ') || 'PKBLVB6V5QWCSU2TLPHJ';
        this.alpacaSecretKey = configService.get('ALPACA_SECRET_KEY', 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG') || 'Vhuk22MepdEauPUtAmxGjfLRoARzwLBiiNvgjpbG';
        this.config = {
            enabled: configService.get('ALPACA_WEBSOCKET_ENABLED', true),
            reconnectIntervalMs: configService.get('ALPACA_RECONNECT_INTERVAL_MS', 5000),
            symbols: []
        };
        this.logger.log(`🚀 Alpaca WebSocket initialized (dynamic subscriptions)`);
    }
};
AlpacaWebSocketService = _ts_decorate([
    (0, _common.Injectable)(),
    _ts_metadata("design:type", Function),
    _ts_metadata("design:paramtypes", [
        typeof _config.ConfigService === "undefined" ? Object : _config.ConfigService
    ])
], AlpacaWebSocketService);

//# sourceMappingURL=alpaca-websocket.service.js.map