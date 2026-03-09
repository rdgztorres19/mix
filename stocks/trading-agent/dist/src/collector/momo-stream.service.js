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
var MomoStreamService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MomoStreamService = void 0;
const common_1 = require("@nestjs/common");
const ws_1 = __importDefault(require("ws"));
const candle_builder_1 = require("./candle-builder");
const WS_URL = 'wss://momoscreener.com/socket.io/?EIO=4&transport=websocket';
const MAX_RECONNECT_DELAY = 30_000;
let MomoStreamService = MomoStreamService_1 = class MomoStreamService {
    constructor() {
        this.logger = new common_1.Logger(MomoStreamService_1.name);
        this.ws = null;
        this.connected = false;
        this.reconnectAttempt = 0;
        this.reconnectTimer = null;
        this.pingTimer = null;
        this.subscribedSymbols = new Set();
        this.destroyed = false;
        this.candleBuilder = new candle_builder_1.CandleBuilder(() => { });
    }
    async init(onCandle, onTick) {
        this.candleBuilder = new candle_builder_1.CandleBuilder(onCandle, onTick);
        this.connect();
    }
    subscribe(symbols) {
        const newSymbols = symbols.filter((s) => !this.subscribedSymbols.has(s));
        if (!newSymbols.length)
            return;
        for (const s of newSymbols)
            this.subscribedSymbols.add(s);
        if (this.ws?.readyState === ws_1.default.OPEN && this.connected) {
            this.sendSubscribe(newSymbols);
        }
    }
    unsubscribe(symbols) {
        for (const s of symbols)
            this.subscribedSymbols.delete(s);
        if (this.ws?.readyState === ws_1.default.OPEN && this.connected) {
            this.ws.send(`42${JSON.stringify(['stoplivequote'])}`);
            if (this.subscribedSymbols.size > 0) {
                this.sendSubscribe([...this.subscribedSymbols]);
            }
        }
    }
    getSubscribedSymbols() {
        return [...this.subscribedSymbols];
    }
    onModuleDestroy() {
        this.destroyed = true;
        this.candleBuilder.flushAll();
        this.cleanup();
        this.logger.log('MomoStreamService destroyed, WS closed');
    }
    cleanup() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.removeAllListeners();
            try {
                this.ws.close(1000, 'shutdown');
            }
            catch { }
            this.ws = null;
        }
        this.connected = false;
    }
    connect() {
        if (this.destroyed)
            return;
        this.cleanup();
        this.logger.log('Connecting to MoMo Screener live quotes…');
        this.ws = new ws_1.default(WS_URL, {
            headers: {
                Origin: 'https://momoscreener.com',
                'User-Agent': 'Mozilla/5.0',
            },
        });
        this.ws.on('open', () => {
            this.logger.log('WebSocket open, waiting for Engine.IO handshake…');
        });
        this.ws.on('message', (raw) => {
            const msg = raw.toString();
            if (msg.startsWith('0{')) {
                try {
                    const handshake = JSON.parse(msg.slice(1));
                    const interval = handshake.pingInterval || 25000;
                    this.pingTimer = setInterval(() => {
                        if (this.ws?.readyState === ws_1.default.OPEN)
                            this.ws.send('3');
                    }, interval);
                }
                catch { }
                this.ws.send('40');
                return;
            }
            if (msg === '2') {
                if (this.ws?.readyState === ws_1.default.OPEN)
                    this.ws.send('3');
                return;
            }
            if (msg === '3')
                return;
            if (msg.startsWith('40')) {
                this.connected = true;
                this.reconnectAttempt = 0;
                this.logger.log('✓ MoMo Socket.IO namespace connected');
                if (this.subscribedSymbols.size > 0) {
                    this.sendSubscribe([...this.subscribedSymbols]);
                }
                return;
            }
            if (msg.startsWith('42')) {
                this.handleEvent(msg);
                return;
            }
        });
        this.ws.on('error', (err) => {
            this.logger.error(`WebSocket error: ${err.message}`);
        });
        this.ws.on('close', () => {
            this.logger.warn('WebSocket closed');
            this.connected = false;
            if (this.pingTimer) {
                clearInterval(this.pingTimer);
                this.pingTimer = null;
            }
            this.scheduleReconnect();
        });
    }
    handleEvent(raw) {
        let data;
        try {
            data = JSON.parse(raw.slice(2));
        }
        catch {
            return;
        }
        const event = data[0];
        const body = data[1];
        if (!body)
            return;
        if (event === 'livequote' && Array.isArray(body.data)) {
            for (const item of body.data) {
                this.processQuote(item);
            }
            return;
        }
        if (event === 'livechart' && Array.isArray(body.data)) {
            for (const item of body.data) {
                this.processQuote(item);
            }
        }
    }
    processQuote(item) {
        const sym = (item.symbol || '').toUpperCase();
        if (!sym || !this.subscribedSymbols.has(sym))
            return;
        const live = item.live;
        if (!live)
            return;
        const price = live.lastPrice;
        const totalVolume = live.totalVolume;
        const quoteTime = live.quoteTime;
        if (typeof price !== 'number' || typeof quoteTime !== 'number')
            return;
        const d = new Date(quoteTime);
        const etParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(d);
        const h = parseInt(etParts.find((p) => p.type === 'hour')?.value ?? '0', 10);
        const m = parseInt(etParts.find((p) => p.type === 'minute')?.value ?? '0', 10);
        const minuteOfDay = h * 60 + m;
        if (minuteOfDay < 570 || minuteOfDay >= 960)
            return;
        const size = typeof totalVolume === 'number' ? 1 : 0;
        this.candleBuilder.onTrade(sym, price, size, quoteTime);
    }
    sendSubscribe(symbols) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return;
        for (const sym of symbols) {
            this.ws.send(`42${JSON.stringify(['livequote', sym])}`);
        }
        this.logger.log(`Subscribed to MoMo livequotes: ${symbols.join(', ')}`);
    }
    scheduleReconnect() {
        if (this.destroyed)
            return;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), MAX_RECONNECT_DELAY);
        this.reconnectAttempt++;
        this.logger.log(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempt})…`);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
    }
};
exports.MomoStreamService = MomoStreamService;
exports.MomoStreamService = MomoStreamService = MomoStreamService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], MomoStreamService);
//# sourceMappingURL=momo-stream.service.js.map