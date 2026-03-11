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
var AlpacaStreamService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlpacaStreamService = void 0;
const common_1 = require("@nestjs/common");
const ws_1 = __importDefault(require("ws"));
const candle_builder_1 = require("./candle-builder");
const WS_URL = 'wss://stream.data.alpaca.markets/v2/iex';
const MAX_RECONNECT_DELAY = 30_000;
let AlpacaStreamService = AlpacaStreamService_1 = class AlpacaStreamService {
    constructor() {
        this.logger = new common_1.Logger(AlpacaStreamService_1.name);
        this.ws = null;
        this.authenticated = false;
        this.reconnectAttempt = 0;
        this.reconnectTimer = null;
        this.subscribedSymbols = new Set();
        this.destroyed = false;
        this.apiKey = process.env.ALPACA_KEY_ID ?? '';
        this.apiSecret = process.env.ALPACA_SECRET_KEY ?? '';
        this.candleBuilder = new candle_builder_1.CandleBuilder(() => { });
    }
    async init(onCandle, onTick) {
        this.candleBuilder = new candle_builder_1.CandleBuilder(onCandle, onTick);
        if (!this.apiKey || !this.apiSecret) {
            this.logger.warn('ALPACA_KEY_ID / ALPACA_SECRET_KEY not set — stream disabled');
            return;
        }
        this.logger.log('Waiting 3s for previous connection to expire…');
        await new Promise((r) => setTimeout(r, 3000));
        this.connect();
    }
    subscribe(symbols) {
        const newSymbols = symbols.filter((s) => !this.subscribedSymbols.has(s));
        if (!newSymbols.length)
            return;
        for (const s of newSymbols)
            this.subscribedSymbols.add(s);
        if (this.ws?.readyState === ws_1.default.OPEN && this.authenticated) {
            this.sendSubscribe(newSymbols);
        }
    }
    unsubscribe(symbols) {
        for (const s of symbols)
            this.subscribedSymbols.delete(s);
        if (this.ws?.readyState === ws_1.default.OPEN && this.authenticated) {
            this.ws.send(JSON.stringify({ action: 'unsubscribe', trades: symbols }));
        }
    }
    getSubscribedSymbols() {
        return [...this.subscribedSymbols];
    }
    onModuleDestroy() {
        this.destroyed = true;
        this.candleBuilder.flushAll();
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        if (this.ws) {
            this.ws.removeAllListeners();
            try {
                this.ws.close(1000, 'shutdown');
            }
            catch { }
            this.ws = null;
        }
        this.logger.log('AlpacaStreamService destroyed, WS closed');
    }
    connect() {
        if (this.destroyed)
            return;
        this.authenticated = false;
        this.logger.log('Connecting to Alpaca real-time trades…');
        this.ws = new ws_1.default(WS_URL);
        this.ws.on('open', () => {
            this.logger.log('WebSocket connected, authenticating…');
            this.ws.send(JSON.stringify({
                action: 'auth',
                key: this.apiKey,
                secret: this.apiSecret,
            }));
        });
        this.ws.on('message', (raw) => {
            let events;
            try {
                events = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
            if (!Array.isArray(events))
                events = [events];
            for (const ev of events) {
                if (ev.T === 'success' && ev.msg === 'authenticated') {
                    this.authenticated = true;
                    this.reconnectAttempt = 0;
                    this.logger.log('✓ Alpaca authenticated');
                    if (this.subscribedSymbols.size > 0) {
                        this.sendSubscribe([...this.subscribedSymbols]);
                    }
                    continue;
                }
                if (ev.T === 'subscription') {
                    this.logger.log(`Subscribed to trades: ${ev.trades?.join(', ') || '(none)'}`);
                    continue;
                }
                if (ev.T === 'error') {
                    this.logger.error(`Alpaca error: ${ev.msg} (code ${ev.code})`);
                    if (ev.code === 406) {
                        this.logger.warn('Connection limit exceeded — will retry in 10s');
                        if (this.ws) {
                            this.ws.removeAllListeners();
                            this.ws.close();
                            this.ws = null;
                        }
                        this.authenticated = false;
                        if (!this.destroyed) {
                            this.reconnectTimer = setTimeout(() => this.connect(), 10_000);
                        }
                        return;
                    }
                    continue;
                }
                if (ev.T === 't') {
                    const symbol = (ev.S || '').toUpperCase();
                    const price = ev.p;
                    const size = ev.s;
                    const ts = new Date(ev.t).getTime();
                    if (symbol && typeof price === 'number' && typeof size === 'number') {
                        this.candleBuilder.onTrade(symbol, price, size, ts);
                    }
                }
            }
        });
        this.ws.on('error', (err) => {
            this.logger.error(`WebSocket error: ${err.message}`);
        });
        this.ws.on('close', () => {
            this.logger.warn('WebSocket closed');
            this.authenticated = false;
            this.scheduleReconnect();
        });
    }
    sendSubscribe(symbols) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return;
        this.ws.send(JSON.stringify({ action: 'subscribe', trades: symbols }));
        this.logger.log(`→ subscribe request: ${symbols.join(', ')}`);
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
exports.AlpacaStreamService = AlpacaStreamService;
exports.AlpacaStreamService = AlpacaStreamService = AlpacaStreamService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], AlpacaStreamService);
//# sourceMappingURL=alpaca-stream.service.js.map