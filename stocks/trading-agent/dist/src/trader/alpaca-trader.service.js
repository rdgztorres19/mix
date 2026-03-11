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
var AlpacaTraderService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AlpacaTraderService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
let AlpacaTraderService = AlpacaTraderService_1 = class AlpacaTraderService {
    constructor() {
        this.logger = new common_1.Logger(AlpacaTraderService_1.name);
        this.enabled = false;
        const baseURL = process.env.ALPACA_PAPER_BASE_URL || 'https://paper-api.alpaca.markets/v2';
        const keyId = process.env.ALPACA_PAPER_KEY_ID || '';
        const secretKey = process.env.ALPACA_PAPER_SECRET_KEY || '';
        this.enabled = !!(keyId && secretKey);
        this.client = axios_1.default.create({
            baseURL,
            headers: {
                'APCA-API-KEY-ID': keyId,
                'APCA-API-SECRET-KEY': secretKey,
                'Content-Type': 'application/json',
            },
            timeout: 10000,
        });
        if (this.enabled) {
            this.logger.log('AlpacaTraderService configured (paper trading)');
        }
        else {
            this.logger.warn('AlpacaTraderService: missing ALPACA_PAPER keys — trading disabled');
        }
    }
    isEnabled() {
        return this.enabled;
    }
    async getAccount() {
        const { data } = await this.client.get('/account');
        return {
            equity: parseFloat(data.equity),
            buying_power: parseFloat(data.buying_power),
            cash: parseFloat(data.cash),
        };
    }
    async buyMarket(symbol, dollarAmount) {
        this.logger.log(`BUY ${symbol} ~$${dollarAmount.toFixed(2)} (market)`);
        const { data } = await this.client.post('/orders', {
            symbol: symbol.toUpperCase(),
            notional: dollarAmount.toFixed(2),
            side: 'buy',
            type: 'market',
            time_in_force: 'day',
        });
        return data;
    }
    async sellMarket(symbol, qty) {
        this.logger.log(`SELL ${symbol} qty=${qty} (market)`);
        const { data } = await this.client.post('/orders', {
            symbol: symbol.toUpperCase(),
            qty: String(qty),
            side: 'sell',
            type: 'market',
            time_in_force: 'day',
        });
        return data;
    }
    async getPosition(symbol) {
        try {
            const { data } = await this.client.get(`/positions/${symbol.toUpperCase()}`);
            return {
                symbol: data.symbol,
                qty: parseFloat(data.qty),
                avg_entry_price: parseFloat(data.avg_entry_price),
                current_price: parseFloat(data.current_price),
                market_value: parseFloat(data.market_value),
                unrealized_pl: parseFloat(data.unrealized_pl),
            };
        }
        catch (err) {
            if (err?.response?.status === 404)
                return null;
            throw err;
        }
    }
    async getAllPositions() {
        const { data } = await this.client.get('/positions');
        return data.map((p) => ({
            symbol: p.symbol,
            qty: parseFloat(p.qty),
            avg_entry_price: parseFloat(p.avg_entry_price),
            current_price: parseFloat(p.current_price),
            market_value: parseFloat(p.market_value),
            unrealized_pl: parseFloat(p.unrealized_pl),
        }));
    }
};
exports.AlpacaTraderService = AlpacaTraderService;
exports.AlpacaTraderService = AlpacaTraderService = AlpacaTraderService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], AlpacaTraderService);
//# sourceMappingURL=alpaca-trader.service.js.map